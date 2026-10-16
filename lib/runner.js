"use strict";

const { createFileIO } = require("./file-io");
const { createImapClient } = require("./imap");
const { launchBrowser, clearBrowserData } = require("./browser");
const {
  initCapsolver,
  submitAppleForgot,
  resetPasswordFromLink,
} = require("./apple-forgot");
const { delay, log } = require("./utils");

// ════════════════════════════════════════════════════════════════════
// ERROR HANDLERS
// ════════════════════════════════════════════════════════════════════
let handlersInstalled = false;
function installErrorHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;
  process.on("uncaughtException", (err) => {
    if (err.code === "ECONNRESET" || err.source === "socket") {
      log.warn("uncaughtException ECONNRESET, continuing");
    } else {
      log.err(`Uncaught: ${err.message}`);
      process.exit(1);
    }
  });
  process.on("unhandledRejection", (reason) => {
    if (reason?.code === "ECONNRESET") {
      log.warn("unhandledRejection ECONNRESET, continuing");
    } else {
      log.err(`Unhandled: ${reason}`);
    }
  });
}

// ════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════
async function safeClose(browser, label) {
  if (!browser) return;
  try {
    await browser.close();
    log.info(`${label} closed`);
  } catch (e) {
    log.warn(`Close ${label} error: ${e.message}`);
  }
}

async function setupApplePage(appleBrowser, config) {
  const page =
    (await appleBrowser.pages())[0] || (await appleBrowser.newPage());

  // Proxy auth
  const appleProxy = config.APPLE_PROXY?.enabled
    ? config.APPLE_PROXY.address
    : null;
  if (appleProxy) {
    const parts = appleProxy.split(":");
    if (parts.length === 4) {
      await page.authenticate({ username: parts[2], password: parts[3] });
      log.proxy(`Proxy auth set: ${parts[0]}:${parts[1]}`);
    }
  }

  // Auto-dismiss dialogs
  page.on("dialog", async (dialog) => {
    await dialog.accept().catch(() => {});
  });

  // Trust headers
  await page.setExtraHTTPHeaders({
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Ch-Ua":
      '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
  });
  await page.setViewport({ width: 1280, height: 700, deviceScaleFactor: 1 });

  return page;
}

async function launchAppleBrowser(config) {
  const appleProxy = config.APPLE_PROXY?.enabled
    ? config.APPLE_PROXY.address
    : null;
  const browser = await launchBrowser(config, !!appleProxy, appleProxy, {
    size: config.BROWSER.WINDOW_SIZE || "640,720",
    position: config.BROWSER.WINDOW_POSITION || "0,0",
  });
  return browser;
}

// ════════════════════════════════════════════════════════════════════
// PROCESS ONE EMAIL
// ════════════════════════════════════════════════════════════════════
async function processOneEmail(applePage, entry, imap, fileIO) {
  const { mailLam, mailGmx, passGmx, raw } = entry;

  try {
    // STEP 1: Apple iForgot + CAPTCHA
    log.divider(`Processing: ${mailLam}`);
    log.info(`GMX: ${mailGmx}`);

    const forgotResult = await submitAppleForgot(applePage, mailLam);

    if (!forgotResult.ok) {
      log.err(`iForgot failed: ${forgotResult.reason}`);
      if (
        forgotResult.reason === "503_need_relaunch" ||
        forgotResult.reason === "502_need_relaunch"
      ) {
        return { ok: false, reason: forgotResult.reason };
      }
      if (forgotResult.reason === "capsolver_fatal") {
        return { ok: false, reason: "capsolver_fatal" };
      }
      await fileIO.writeFailed(entry, `iforgot_${forgotResult.reason}`);
      await fileIO.removeFromInput(raw);
      return { ok: false, reason: forgotResult.reason };
    }

    // STEP 2: IMAP GMX — lấy Apple reset link
    log.info("Waiting for Apple reset email...");
    await delay(5000);

    let resetData;
    try {
      resetData = await imap.getAppleResetLink(mailGmx, passGmx);
    } catch (err) {
      log.err(`IMAP failed: ${err.message}`);
      await fileIO.writeFailed(entry, "imap_no_reset_link");
      await fileIO.removeFromInput(raw);
      return { ok: false, reason: "imap_fail" };
    }

    // STEP 3: Mở reset link → đổi password
    const resetResult = await resetPasswordFromLink(
      applePage,
      resetData.resetLink,
    );

    if (!resetResult.ok) {
      log.err(`Reset failed: ${resetResult.reason}`);
      await fileIO.writeFailed(entry, `reset_${resetResult.reason}`);
      await fileIO.removeFromInput(raw);
      return { ok: false, reason: resetResult.reason };
    }

    // STEP 4: Thành công
    await fileIO.writeSuccess(entry, resetResult.newPassword);
    await fileIO.removeFromInput(raw);
    return { ok: true, password: resetResult.newPassword };
  } catch (err) {
    log.err(`Unexpected error: ${err.message}`);
    await fileIO.writeFailed(entry, `error_${err.message.slice(0, 80)}`);
    await fileIO.removeFromInput(raw);
    return { ok: false, reason: err.message };
  }
}

// ════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════
async function runMain(config) {
  installErrorHandlers();

  console.log(`
╔═══════════════════════════════════════════════╗
║   Apple iForgot Password Reset (GMX.de)       ║
║         IMAP: ${config.IMAP.host.padEnd(28)}║
║         Input: ${config.PATHS.INPUT.padEnd(27)}║
╚═══════════════════════════════════════════════╝
  `);

  // Init CapSolver (enabled/disabled từ config)
  initCapsolver(config);

  const fileIO = createFileIO(config);
  const imap = createImapClient(config);

  const entries = await fileIO.readInputList();
  if (!entries.length) {
    log.err("No emails in input file");
    return;
  }

  let appleBrowser = null;
  let applePage = null;
  let totalSuccess = 0;
  let totalFailed = 0;

  try {
    // Launch browser
    appleBrowser = await launchAppleBrowser(config);
    applePage = await setupApplePage(appleBrowser, config);

    // Warm up
    log.info("Warming up browser...");
    await applePage
      .goto("https://www.apple.com/", {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      })
      .catch(() => {});
    await delay(2000);

    // Process từng email
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      const result = await processOneEmail(applePage, entry, imap, fileIO);

      if (result.ok) {
        totalSuccess++;
        log.ok(
          `[${totalSuccess} total] ✅ ${entry.mailLam} → ${result.password}`,
        );
      } else if (
        result.reason === "503_need_relaunch" ||
        result.reason === "502_need_relaunch"
      ) {
        // Relaunch browser
        log.warn(`${result.reason} → relaunching browser...`);
        await safeClose(appleBrowser, `Apple browser (${result.reason})`);
        await delay(5000);
        appleBrowser = await launchAppleBrowser(config);
        applePage = await setupApplePage(appleBrowser, config);
        log.ok("Browser relaunched — retrying...");
        i--; // retry same email
        continue;
      } else if (result.reason === "capsolver_fatal") {
        log.err("⛔ CapSolver fatal — stopping");
        break;
      } else {
        totalFailed++;
        log.err(`[FAIL] ${entry.mailLam}: ${result.reason}`);
      }

      // Clear browser sau mỗi mail
      log.info("Clearing browser...");
      try {
        await clearBrowserData(applePage);
        await applePage.goto("about:blank", { timeout: 5000 }).catch(() => {});
        await applePage.setExtraHTTPHeaders({
          "Accept-Language": "en-US,en;q=0.9",
          "Sec-Ch-Ua":
            '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
          "Sec-Ch-Ua-Mobile": "?0",
          "Sec-Ch-Ua-Platform": '"Windows"',
        });
      } catch {}

      await delay(2000);
    }
  } catch (e) {
    log.err(`Fatal: ${e.message}`);
  } finally {
    await safeClose(appleBrowser, "Apple browser");
  }

  console.log(`
╔═══════════════════════════════════════════════╗
║              Processing Complete              ║
║  ✅ Successful: ${totalSuccess.toString().padEnd(29)}║
║  ❌ Failed:     ${totalFailed.toString().padEnd(29)}║
╚═══════════════════════════════════════════════╝
  `);
}

module.exports = { runMain };
