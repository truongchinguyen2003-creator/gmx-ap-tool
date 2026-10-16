"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
const ask = (q) => new Promise((r) => rl.question(q, r));

// 2K (2560x1440) — 2x2 grid, mỗi instance 1 browser
const LAYOUTS = {
  1: ["0,0"],
  2: ["0,0", "1280,0"],
  3: ["0,0", "1280,0", "0,720"],
  4: ["0,0", "1280,0", "0,720", "1280,720"],
};

const CAPSOLVER_KEY =
  "CAP-1FF7B8AA38122C12E4A08F49F9586DDEF3CBF6D4CEB757E308F376891C8154B2";
const APPLE_PROXY = "rp.scrapegw.com:6060:ebfv0pt462nv0ts:k46s12a1wjuuzb0";

function configContent(num, position) {
  return `const path = require("path");

module.exports = {
  APPLE_PROXY: { enabled: true, address: "${APPLE_PROXY}" },
  BROWSER: {
    HEADLESS: false,
    WINDOW_SIZE: "1280,720",
    WINDOW_POSITION: "${position}",
  },
  IMAP: {
    host: "imap.gmx.net",
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
    authTimeout: 30000,
    connTimeout: 20000,
  },
  MAIL_RETRY: { MAX_RETRIES: 8, RETRY_DELAY: 5000 },
  CAPSOLVER: { enabled: false, apiKey: "${CAPSOLVER_KEY}" },
  PATHS: {
    INPUT: path.join("data${num}", "input${num}.txt"),
    OUTPUT_SUCCESS: path.join("data${num}", "thanhcong${num}.txt"),
    OUTPUT_FAILED: path.join("data${num}", "failed${num}.txt"),
  },
};
`;
}

function mainContent(num) {
  return `"use strict";
const config = require("./configs/config${num}.js");
process.env.CAPSOLVER_KEY = config.CAPSOLVER.enabled ? config.CAPSOLVER.apiKey : "";
const { runMain } = require("./lib/runner");
runMain(config).catch((e) => console.error(\`Fatal: \${e.message}\`));
`;
}

async function main() {
  console.log(`
╔═══════════════════════════════════════════════╗
║   Apple iForgot GMX — Setup Wizard            ║
╚═══════════════════════════════════════════════╝`);

  const countStr = await ask("\n  How many instances? (1-4): ");
  const count = Math.min(Math.max(parseInt(countStr) || 1, 1), 4);
  const positions = LAYOUTS[count];

  console.log(`\n  Creating ${count} instance(s)...\n`);

  const configDir = path.join(process.cwd(), "configs");
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

  for (let i = 0; i < count; i++) {
    const num = i + 1;
    const dataDir = path.join(process.cwd(), `data${num}`);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const files = [
      {
        name: `input${num}.txt`,
        content: `# Format: maillam|mailgmx|passgmx\n`,
      },
      { name: `thanhcong${num}.txt`, content: "" },
      { name: `failed${num}.txt`, content: "" },
    ];
    for (const f of files) {
      const fp = path.join(dataDir, f.name);
      if (!fs.existsSync(fp)) fs.writeFileSync(fp, f.content, "utf-8");
    }

    fs.writeFileSync(
      path.join(configDir, `config${num}.js`),
      configContent(num, positions[i]),
      "utf-8",
    );

    const mainPath = path.join(process.cwd(), `main${num}.js`);
    if (!fs.existsSync(mainPath))
      fs.writeFileSync(mainPath, mainContent(num), "utf-8");

    console.log(
      `  ✅ Instance ${num}: data${num}/input${num}.txt → node main${num}.js`,
    );
  }

  console.log(`
  Input format: maillam|mailgmx|passgmx
  Example:      john@icloud.com|mymail@gmx.de|mypassword123

  Run: node main1.js
  `);

  rl.close();
}

main();
