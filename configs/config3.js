const path = require("path");

module.exports = {
  APPLE_PROXY: {
    enabled: true,
    address: "rp.scrapegw.com:6060:ebfv0pt462nv0ts:k46s12a1wjuuzb0",
  },
  BROWSER: {
    HEADLESS: false,
    WINDOW_SIZE: "1280,720",
    WINDOW_POSITION: "0,720",
  },
  IMAP: {
    host: "imap.gmx.net",
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
    authTimeout: 30000,
    connTimeout: 20000,
  },
  MAIL_RETRY: { MAX_RETRIES: 5, RETRY_DELAY: 5000 },
  CAPSOLVER: {
    enabled: true,
    apiKey:
      "CAP-1FF7B8AA38122C12E4A08F49F9586DDEF3CBF6D4CEB757E308F376891C8154B2",
  },
  PATHS: {
    INPUT: path.join("data3", "input3.txt"),
    OUTPUT_SUCCESS: path.join("data3", "thanhcong3.txt"),
    OUTPUT_FAILED: path.join("data3", "failed3.txt"),
  },
};
