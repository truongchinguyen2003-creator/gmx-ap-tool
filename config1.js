const path = require("path");

module.exports = {
  APPLE_PROXY: { enabled: true, address: "rp.scrapegw.com:6060:ebfv0pt462nv0ts:k46s12a1wjuuzb0" },
  BROWSER: {
    HEADLESS: false,
    WINDOW_SIZE: "640,720",
    WINDOW_POSITION: "0,0",
  },
  IMAP: {
    host: "imap.gmx.net",
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
    authTimeout: 30000,
    connTimeout: 20000,
  },
  MAIL_RETRY: {
    MAX_RETRIES: 8,
    RETRY_DELAY: 5000,
  },
  CAPSOLVER: { enabled: false, apiKey: "CAP-EB71D0266831880ECC1BB2B3B5145AD0AF1EF96706FADCCC5FF9A16CA863F69C" },
  PATHS: {
    INPUT: path.join("data1", "input1.txt"),
    OUTPUT_SUCCESS: path.join("data1", "thanhcong1.txt"),
    OUTPUT_FAILED: path.join("data1", "failed1.txt"),
  },
};
