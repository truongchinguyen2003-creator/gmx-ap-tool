"use strict";

const { delay, randomDelay, log, generateRandomPassword } = require("./utils");
const readline = require("readline");

const MAX_CAPTCHA_RETRIES = 5;

// CapSolver config — set từ runner qua initCapsolver()
let capsolverEnabled = false;
let capsolverApiKey = "";

function initCapsolver(config) {
  const cap = config?.CAPSOLVER || {};
  capsolverEnabled = cap.enabled === true;
  capsolverApiKey = cap.apiKey || "";
  if (capsolverEnabled && capsolverApiKey) {
    log.ok(`CapSolver ON (key: ${capsolverApiKey.slice(0, 8)}...)`);
  } else {
    log.warn("CapSolver OFF → manual CAPTCHA mode");
  }
}

// ════════════════════════════════════════════════════════════════════
// MANUAL INPUT
// ════════════════════════════════════════════════════════════════════
function askManual(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ════════════════════════════════════════════════════════════════════
// CAPSOLVER
// ════════════════════════════════════════════════════════════════════
async function solveCaptcha(base64Image) {
  const res = await fetch("https://api.capsolver.com/createTask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey: capsolverApiKey,
      task: {
        type: "ImageToTextTask",
        body: base64Image,
        websiteURL: "https://iforgot.apple.com",
        case: true,
        module: "common",
      },
    }),
  });
  const data = await res.json();
  if (data.errorId !== 0) {
    throw new Error(`CapSolver error: ${data.errorDescription}`);
  }
  if (data.solution?.text) return data.solution.text;

  const taskId = data.taskId;
  for (let i = 0; i < 20; i++) {
    await delay(3000);
    const r = await fetch("https://api.capsolver.com/getTaskResult", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: capsolverApiKey, taskId }),
    });
    const rd = await r.json();
    if (rd.status === "ready") return rd.solution.text;
    if (rd.status === "failed")
      throw new Error(`CapSolver failed: ${rd.errorDescription}`);
  }
  throw new Error("CapSolver timeout");
}

// ════════════════════════════════════════════════════════════════════
// STEP 1: iforgot CAPTCHA → send reset email
// ════════════════════════════════════════════════════════════════════
async function submitAppleForgot(page, email) {
  log.divider(`Apple iForgot: ${email}`);

  // Load page với retry khi 503
  const IFORGOT_URL =
    "https://iforgot.apple.com/password/verify/appleid?language=US-EN";
  for (let loadAttempt = 1; loadAttempt <= 3; loadAttempt++) {
    await page
      .goto(IFORGOT_URL, { waitUntil: "networkidle2", timeout: 30000 })
      .catch(() => {});
    await delay(2000);

    const is503 = await page
      .evaluate(() => {
        const body = document.body?.innerText || "";
        return (
          body.includes("503") ||
          body.includes("Service Temporarily Unavailable") ||
          body.includes("Service Unavailable")
        );
      })
      .catch(() => false);

    if (!is503) break;

    log.warn(`503 Service Unavailable (attempt ${loadAttempt}/3)`);
    if (loadAttempt >= 2) {
      log.warn("Returning 503_need_relaunch → browser will be relaunched");
      return { ok: false, reason: "503_need_relaunch" };
    }
    try {
      const client = await page.target().createCDPSession();
      await client.send("Network.clearBrowserCookies");
      await client.send("Network.clearBrowserCache");
    } catch {}
    await page.goto("about:blank", { timeout: 5000 }).catch(() => {});
    await delay(8000);
  }

  // Enter email
  log.info("Entering email...");
  const emailInput = await page.waitForSelector("input.iforgot-apple-id", {
    timeout: 15000,
  });
  await emailInput.click();
  await delay(500);
  await page.evaluate((val) => {
    const inp = document.querySelector("input.iforgot-apple-id");
    if (inp) {
      inp.focus();
      inp.value = val;
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
      inp.dispatchEvent(new Event("blur", { bubbles: true }));
    }
  }, email);
  await delay(1000);
  // Verify value
  const filledEmail = await page.evaluate(() => {
    const inp = document.querySelector("input.iforgot-apple-id");
    return inp ? inp.value : "";
  });
  log.info(`Email filled: "${filledEmail}"`);

  // CAPTCHA retry loop
  for (let attempt = 1; attempt <= MAX_CAPTCHA_RETRIES; attempt++) {
    log.info(`[CAPTCHA attempt ${attempt}/${MAX_CAPTCHA_RETRIES}]`);

    // Nếu retry → reload toàn bộ page + nhập lại email
    if (attempt > 1) {
      log.info("Reloading page + re-entering email...");
      await page
        .goto(IFORGOT_URL, { waitUntil: "networkidle2", timeout: 30000 })
        .catch(() => {});
      await delay(2000);

      // Check 503
      const is503 = await page
        .evaluate(() => {
          const body = document.body?.innerText || "";
          return body.includes("503") || body.includes("Service Unavailable");
        })
        .catch(() => false);
      if (is503) {
        log.warn("503 on reload");
        return { ok: false, reason: "503_need_relaunch" };
      }

      // Nhập lại email
      const retryInput = await page
        .waitForSelector("input.iforgot-apple-id", { timeout: 10000 })
        .catch(() => null);
      if (!retryInput) {
        log.warn("Email input not found after reload");
        continue;
      }
      await retryInput.click();
      await delay(300);
      await page.evaluate((val) => {
        const inp = document.querySelector("input.iforgot-apple-id");
        if (inp) {
          inp.focus();
          inp.value = val;
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          inp.dispatchEvent(new Event("change", { bubbles: true }));
          inp.dispatchEvent(new Event("blur", { bubbles: true }));
        }
      }, email);
      await delay(1000);
    }

    // Wait for CAPTCHA image
    const captchaImg = await page
      .waitForSelector(
        "img[alt='Image challenge'], img[alt='Type the characters you see or hear']",
        { timeout: 10000 },
      )
      .catch(() => null);

    if (!captchaImg) {
      log.warn("CAPTCHA image not found");
      if (attempt >= MAX_CAPTCHA_RETRIES)
        return { ok: false, reason: "no_captcha_image" };
      continue;
    }
    await delay(1500);

    // Screenshot CAPTCHA — gửi ảnh gốc (chỉ scale 2x, giữ nguyên màu)
    // CapSolver AI được train trên ảnh gốc → giữ nguyên cho accuracy tốt nhất
    const base64 = await page
      .evaluate(() => {
        const img = document.querySelector(
          "img[alt='Image challenge'], img[alt='Type the characters you see or hear']",
        );
        if (!img) return null;

        const canvas = document.createElement("canvas");
        const scale = 2;
        canvas.width = img.naturalWidth * scale;
        canvas.height = img.naturalHeight * scale;
        const ctx = canvas.getContext("2d");

        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        return canvas.toDataURL("image/png").split(",")[1];
      })
      .catch(() => null);

    if (!base64) {
      log.warn("Failed to capture CAPTCHA image");
      if (attempt >= MAX_CAPTCHA_RETRIES)
        return { ok: false, reason: "captcha_process_fail" };
      continue;
    }
    log.info(
      `CAPTCHA captured: ${base64.length} chars (2x scaled, original colors)`,
    );

    // Solve CAPTCHA
    let captchaText;

    if (capsolverEnabled && capsolverApiKey) {
      // Auto mode — CapSolver
      try {
        captchaText = await solveCaptcha(base64);
      } catch (err) {
        log.warn(`CapSolver error: ${err.message}`);
        if (
          err.message.includes("invalid") ||
          err.message.includes("insufficient") ||
          err.message.includes("balance")
        ) {
          log.err("CapSolver API key invalid or balance empty — stopping");
          return { ok: false, reason: "capsolver_fatal" };
        }
        if (attempt >= MAX_CAPTCHA_RETRIES)
          return { ok: false, reason: "capsolver_fail" };
        continue;
      }
    } else {
      // Manual mode — nhập tay
      captchaText = await askManual("⌨️  Nhập CAPTCHA: ");
      if (!captchaText) {
        if (attempt >= MAX_CAPTCHA_RETRIES)
          return { ok: false, reason: "manual_empty" };
        continue;
      }
    }
    log.ok(`CAPTCHA result: "${captchaText}"`);

    // Enter CAPTCHA
    const captchaInput = await page.waitForSelector("input.captcha-input", {
      timeout: 10000,
    });
    await captchaInput.click();
    await delay(300);
    await page.evaluate((val) => {
      const inp = document.querySelector("input.captcha-input");
      if (inp) {
        inp.focus();
        inp.value = val;
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        inp.dispatchEvent(new Event("blur", { bubbles: true }));
      }
    }, captchaText);
    await delay(500);
    log.info(`CAPTCHA filled: "${captchaText}"`);

    // Click Continue
    log.info("Clicking Continue...");
    await page.evaluate(() => {
      const btn = document.querySelector("button.button-primary.nav-action");
      if (btn) btn.click();
    });

    // Chờ page chuyển — poll tối đa 15s
    log.info("Waiting for page transition...");
    let transitioned = false;
    for (let w = 0; w < 15; w++) {
      await delay(1000);
      const stillCaptcha = await page
        .evaluate(() => {
          return !!document.querySelector("input.captcha-input");
        })
        .catch(() => false);

      if (!stillCaptcha) {
        transitioned = true;
        log.ok("Page transitioned from CAPTCHA");
        break;
      }

      // Check modal overlay "Account locked" (có thể hiện ngay trên trang CAPTCHA, không cần transition)
      // Apple hiện modal .idms-modal-content — tiếng Đức: "gesperrt", tiếng Anh: "locked"
      const modalCheck = await page
        .evaluate(() => {
          const modal = document.querySelector(".idms-modal-content");
          if (modal) return modal.textContent.trim().toLowerCase();
          // Fallback: check body + subtitle
          const sub = document.querySelector("p.subtitle");
          const body = document.body?.innerText || "";
          return (
            (sub ? sub.textContent : "") +
            " " +
            body.slice(0, 500)
          ).toLowerCase();
        })
        .catch(() => "");

      if (
        modalCheck.includes("gesperrt") ||
        modalCheck.includes("account is locked") ||
        (modalCheck.includes("locked") && modalCheck.includes("account"))
      ) {
        log.err("Account locked (modal detected during transition wait)");
        return { ok: false, reason: "account_locked" };
      }
      if (
        modalCheck.includes("not valid") ||
        modalCheck.includes("not supported") ||
        modalCheck.includes("nicht gültig")
      ) {
        log.err("Account not valid (detected during transition wait)");
        return { ok: false, reason: "account_not_valid" };
      }

      // Check nếu có error message trong khi chờ
      const err = await page
        .evaluate(() => {
          const el = document.querySelector(".form-message");
          return el ? el.textContent.trim() : "";
        })
        .catch(() => "");

      if (
        err.includes("characters") ||
        err.includes("enter the characters") ||
        err.includes("Please type")
      ) {
        log.warn(`CAPTCHA wrong: "${err}" — will reload page`);
        break; // break inner wait loop → outer loop sẽ reload page + nhập lại email
      }

      // "Your request could not be completed" → cũng break, outer loop reload
      if (
        err.includes("could not be completed") ||
        err.includes("Try again later")
      ) {
        log.warn(`Server error: "${err}" — will reload page`);
        break;
      }
    }

    if (!transitioned) {
      // Vẫn còn trên trang CAPTCHA → CAPTCHA sai hoặc chưa chuyển
      if (attempt < MAX_CAPTCHA_RETRIES) continue;
      return { ok: false, reason: "captcha_wrong_or_stuck" };
    }

    // ── Page đã chuyển — detect trang mới ──
    await delay(2000); // chờ thêm cho page render xong

    // Helper: đọc subtitle hiện tại (check modal → p.subtitle → span title → h1)
    const getSubtitle = () =>
      page
        .evaluate(() => {
          // Check modal overlay trước (Apple hiện modal cho locked/error bằng tiếng Đức)
          const modal = document.querySelector(
            ".idms-modal-content .idms-step-title, .idms-modal-content h2",
          );
          if (modal && modal.textContent.trim())
            return modal.textContent.trim();
          const p = document.querySelector("p.subtitle");
          if (p && p.textContent.trim()) return p.textContent.trim();
          // Fallback: check span với class chứa "step-title"
          const span = document.querySelector(
            "span[class*='step-title'], span[id*='step-title']",
          );
          if (span && span.textContent.trim()) return span.textContent.trim();
          // Fallback: check h1
          const h1 = document.querySelector("h1");
          if (h1 && h1.textContent.trim()) return h1.textContent.trim();
          return "";
        })
        .catch(() => "");

    // Helper: click Continue/action button
    const clickContinue = () =>
      page.evaluate(() => {
        const btn =
          document.querySelector("button#action") ||
          document.querySelector("button.button-primary.nav-action") ||
          document.querySelector("button:not([disabled]).button-primary");
        if (btn) btn.click();
      });

    let subtitle = await getSubtitle();
    log.info(`Page subtitle: "${subtitle}"`);

    const subLower = subtitle.toLowerCase();

    // Check "Apple Account is not valid or not supported" (EN + DE) → fail ngay
    if (
      subLower.includes("not valid") ||
      subLower.includes("not supported") ||
      subLower.includes("nicht gültig") ||
      subLower.includes("nicht unterstützt")
    ) {
      log.err(`Account not valid: "${subtitle}"`);
      return { ok: false, reason: "account_not_valid" };
    }

    // Check "This account is locked" (EN + DE: "gesperrt") → fail ngay
    if (
      subLower.includes("account is locked") ||
      subLower.includes("locked") ||
      subLower.includes("gesperrt")
    ) {
      log.err(`Account locked: "${subtitle}"`);
      return { ok: false, reason: "account_locked" };
    }

    // Check "Confirm your birthday" (EN + DE: "Geburtstag") → fail ngay
    if (
      subLower.includes("confirm your birthday") ||
      subLower.includes("birthday") ||
      subLower.includes("geburtstag")
    ) {
      log.err(`Birthday required: "${subtitle}"`);
      return { ok: false, reason: "birthday_required" };
    }

    // Check "Confirm your phone number" (EN + DE: "Telefonnummer") → fail ngay
    if (
      subLower.includes("phone number") ||
      subLower.includes("telefonnummer")
    ) {
      log.err(`Phone number required: "${subtitle}"`);
      return { ok: false, reason: "phone_number_required" };
    }

    // Check "Enter Recovery Key" (EN + DE: "Wiederherstellungsschlüssel") → fail ngay
    if (
      subLower.includes("recovery key") ||
      subLower.includes("wiederherstellungsschlüssel")
    ) {
      log.err(`Recovery key required: "${subtitle}"`);
      return { ok: false, reason: "recovery_key_required" };
    }

    // Check "Select what information you want to reset" → bấm Continue
    if (
      subtitle.toLowerCase().includes("select what information") ||
      subtitle.toLowerCase().includes("what you want to reset")
    ) {
      log.ok("'Select what information' page → clicking Continue...");
      await delay(1000);
      await clickContinue();
      // Chờ chuyển sang trang tiếp
      for (let w = 0; w < 15; w++) {
        await delay(1000);
        subtitle = await getSubtitle();
        if (!subtitle.toLowerCase().includes("select what information")) break;
      }
      log.info(`After select info → subtitle: "${subtitle}"`);
    }

    // Check "Choose how to unlock" page
    const hasUnlock =
      subtitle.toLowerCase().includes("unlock") ||
      subtitle.toLowerCase().includes("choose") ||
      subtitle.toLowerCase().includes("how you want");

    if (hasUnlock) {
      log.ok("CAPTCHA correct → unlock method page");
      await delay(1000);
      // Click Continue (Get an email already selected)
      await page.evaluate(() => {
        const btn =
          document.querySelector("button#action") ||
          document.querySelector("button:not([disabled]).button-primary");
        if (btn) btn.click();
      });

      // Chờ trang "Email Sent" load — poll tối đa 15s
      log.info("Waiting for Email Sent page...");
      for (let w = 0; w < 15; w++) {
        await delay(1000);
        const subtitle = await page
          .evaluate(() => {
            const p = document.querySelector("p.subtitle");
            return p ? p.textContent.trim() : "";
          })
          .catch(() => "");

        if (
          subtitle.includes("Email Sent") ||
          subtitle.includes("email has been sent") ||
          subtitle.includes("Unlock")
        ) {
          log.ok("Reset email sent successfully");
          return { ok: true };
        }
      }

      // Vẫn không thấy → check body text
      const bodyText = await page
        .evaluate(() => document.body.innerText)
        .catch(() => "");
      if (
        bodyText.includes("Email Sent") ||
        bodyText.includes("email has been sent") ||
        bodyText.includes("reset")
      ) {
        log.ok("Reset email sent successfully");
        return { ok: true };
      }

      // CAPTCHA đúng, unlock page đúng, nhưng email sent không detect → vẫn coi là OK
      log.warn(
        "Unlock page detected but Email Sent not confirmed — assuming sent",
      );
      return { ok: true };
    }

    // Check "Email has been sent" trực tiếp (không qua unlock page)
    const pageText = await page
      .evaluate(() => {
        const p = document.querySelector("p.subtitle");
        return p ? p.textContent : "";
      })
      .catch(() => "");

    if (
      pageText.includes("Email Sent") ||
      pageText.includes("email has been sent") ||
      pageText.includes("Unlock")
    ) {
      log.ok("Reset email sent successfully");
      return { ok: true };
    }

    log.warn("Unknown page after clicking Continue");
    // Log actual page content for debugging
    const debugSubtitle = subtitle || "(no subtitle)";
    log.info(`Current subtitle: "${debugSubtitle}"`);

    // Check body text cho locked / not valid trước khi retry (EN + DE)
    const bodyCheck = (
      await page.evaluate(() => document.body?.innerText || "").catch(() => "")
    ).toLowerCase();
    if (
      bodyCheck.includes("account is locked") ||
      bodyCheck.includes("gesperrt")
    ) {
      log.err("Account is locked (detected from body)");
      return { ok: false, reason: "account_locked" };
    }
    if (
      bodyCheck.includes("not valid") ||
      bodyCheck.includes("not supported") ||
      bodyCheck.includes("nicht gültig")
    ) {
      log.err("Account not valid (detected from body)");
      return { ok: false, reason: "account_not_valid" };
    }

    if (attempt >= MAX_CAPTCHA_RETRIES) {
      return { ok: false, reason: "unknown_page" };
    }
  }

  return { ok: false, reason: "max_retries" };
}

async function refreshCaptcha(page) {
  try {
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, a"));
      for (const b of btns) {
        const txt = (b.textContent || "").trim().toLowerCase();
        if (
          txt.includes("new code") ||
          txt.includes("new captcha") ||
          txt.includes("refresh")
        ) {
          b.click();
          return true;
        }
      }
      return false;
    });
    if (clicked) log.info("Refreshed CAPTCHA");
  } catch {}
  await delay(2000);
}

// ════════════════════════════════════════════════════════════════════
// STEP 2: Open reset link → change password
// ════════════════════════════════════════════════════════════════════
async function resetPasswordFromLink(page, resetLink) {
  log.divider("Apple Reset Password");
  log.info(`Opening: ${resetLink.slice(0, 80)}...`);

  // Retry mở link tối đa 3 lần (SSL error, timeout, network)
  let loaded = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(resetLink, { waitUntil: "networkidle2", timeout: 30000 });
      loaded = true;
      break;
    } catch (err) {
      log.warn(
        `Open reset link failed (attempt ${attempt}/3): ${err.message.slice(0, 80)}`,
      );
      if (attempt < 3) {
        await delay(5000);
        await page.goto("about:blank", { timeout: 5000 }).catch(() => {});
        await delay(2000);
      }
    }
  }
  if (!loaded) {
    return { ok: false, reason: "reset_link_network_error" };
  }
  await delay(3000);

  // Detect current page
  const pageState = await page.evaluate(() => {
    const subtitle = document.querySelector("p.subtitle");
    const text = subtitle ? subtitle.textContent.trim() : "";
    if (text.includes("Enter Password")) return "enter_password";
    if (text.includes("New Apple") && text.includes("Password"))
      return "new_password";
    return "unknown:" + text.slice(0, 60);
  });

  log.info(`Page state: ${pageState}`);

  // CASE 1: "Enter Password" → click "Forgot password?"
  if (pageState === "enter_password") {
    log.info("Case 1: Enter Password → clicking Forgot password...");

    // Click thật bằng Puppeteer (isTrusted=true)
    const forgotBtn = await page
      .waitForSelector("button.forgot-pwd, .forgot-pwd, a.forgot-pwd", {
        timeout: 10000,
      })
      .catch(() => null);
    if (!forgotBtn) {
      // Fallback: tìm bằng text
      const clicked = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button, a"));
        for (const b of btns) {
          if (
            (b.textContent || "")
              .trim()
              .toLowerCase()
              .includes("forgot password")
          ) {
            b.click();
            return true;
          }
        }
        return false;
      });
      if (!clicked) return { ok: false, reason: "forgot_pwd_btn_not_found" };
      log.info("Clicked via text fallback");
    } else {
      await forgotBtn.click();
      log.ok("Clicked Forgot password button");
    }

    // Poll tối đa 20s chờ trang "New Apple Account Password"
    log.info("Waiting for New Password page...");
    let hasNewPwd = false;
    for (let w = 0; w < 20; w++) {
      await delay(1000);
      hasNewPwd = await page
        .evaluate(() => {
          const subtitle = document.querySelector("p.subtitle");
          return subtitle
            ? subtitle.textContent.includes("New Apple") ||
                subtitle.textContent.includes("New Password")
            : false;
        })
        .catch(() => false);
      if (hasNewPwd) break;
    }

    if (!hasNewPwd) {
      return { ok: false, reason: "new_password_page_not_appeared" };
    }
    log.ok("Navigated to New Password page");
  }
  // CASE 2: Directly "New Apple Account Password"
  else if (pageState === "new_password") {
    log.ok("Case 2: Direct New Password page");
  } else {
    log.warn(`Unknown page state: ${pageState}`);
    return { ok: false, reason: `unknown_page: ${pageState}` };
  }

  // Generate password & fill
  const newPassword = generateRandomPassword(18);
  log.info(`Generated password: ${newPassword}`);
  await delay(1000);

  // Fill password field 1
  const pwd1 = await page
    .waitForSelector("input#password, input.pwd", { timeout: 10000 })
    .catch(() => null);
  if (!pwd1) return { ok: false, reason: "password_field_1_not_found" };
  await pwd1.click({ clickCount: 3 });
  await pwd1.type(newPassword, { delay: 50 });
  await delay(500);

  // Fill password field 2 (confirm)
  const pwd2Selector = await page.evaluate(() => {
    const inputs = Array.from(
      document.querySelectorAll('input[type="password"]'),
    );
    if (inputs.length >= 2) {
      const second = inputs[1];
      return second.id ? `#${second.id}` : null;
    }
    return null;
  });

  if (pwd2Selector) {
    const pwd2 = await page.$(pwd2Selector);
    if (pwd2) {
      await pwd2.click({ clickCount: 3 });
      await pwd2.type(newPassword, { delay: 50 });
    }
  } else {
    const filled = await page.evaluate((pw) => {
      const inputs = Array.from(
        document.querySelectorAll('input[type="password"]'),
      );
      if (inputs.length >= 2) {
        const inp = inputs[1];
        inp.focus();
        inp.value = pw;
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      return false;
    }, newPassword);
    if (!filled) {
      return { ok: false, reason: "password_field_2_not_found" };
    }
  }

  await delay(1000);

  // Click "Reset Password"
  log.info("Clicking Reset Password...");
  await page.evaluate(() => {
    const btn =
      document.querySelector("button#action") ||
      document.querySelector("button.button-primary:not([disabled])");
    if (btn) btn.click();
  });
  await delay(5000);

  // Check success
  const success = await page
    .evaluate(() => {
      const subtitle = document.querySelector("p.subtitle");
      const text = subtitle ? subtitle.textContent.trim() : "";
      return text.includes("Unlocked") || text.includes("Password Changed");
    })
    .catch(() => false);

  if (success) {
    log.ok(`Password changed successfully! New: ${newPassword}`);
    return { ok: true, newPassword };
  }

  // Retry click if button was disabled
  log.warn("Success page not detected, retrying click...");
  await page.evaluate(() => {
    const btn = document.querySelector("button#action");
    if (btn) {
      btn.removeAttribute("disabled");
      btn.click();
    }
  });
  await delay(5000);

  const success2 = await page
    .evaluate(() => {
      const text = document.body.innerText || "";
      return text.includes("Unlocked") || text.includes("Password Changed");
    })
    .catch(() => false);

  if (success2) {
    log.ok(`Password changed successfully! New: ${newPassword}`);
    return { ok: true, newPassword };
  }

  return { ok: false, reason: "reset_not_confirmed" };
}

module.exports = {
  initCapsolver,
  submitAppleForgot,
  resetPasswordFromLink,
  solveCaptcha,
};
