"use strict";

const Imap = require("imap");
const { simpleParser } = require("mailparser");
const { delay, log } = require("./utils");

function createImapClient(config) {
  function connectImap(email, password) {
    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user: email,
        password: password,
        host: config.IMAP.host,
        port: config.IMAP.port,
        tls: config.IMAP.tls,
        tlsOptions: config.IMAP.tlsOptions,
        connTimeout: config.IMAP.connTimeout || 20000,
        authTimeout: config.IMAP.authTimeout || 15000,
      });
      imap.once("ready", () => resolve(imap));
      imap.once("error", reject);
      imap.connect();
    });
  }

  function fetchInboxMessages(imap, count = 50) {
    return new Promise((resolve, reject) => {
      imap.openBox("INBOX", true, (err, box) => {
        if (err) return reject(err);
        if (!box.messages.total) return resolve([]);

        const total = box.messages.total;
        const start = Math.max(1, total - (count - 1));
        const f = imap.seq.fetch(`${start}:${total}`, {
          bodies: "",
          struct: true,
        });

        const promises = [];
        f.on("message", (msg) => {
          promises.push(
            new Promise((res) => {
              let buf = "";
              msg.on("body", (stream) => {
                stream.on("data", (c) => (buf += c.toString("utf8")));
              });
              msg.once("end", async () => {
                try { res(await simpleParser(buf)); }
                catch { res(null); }
              });
            }),
          );
        });
        f.once("error", reject);
        f.once("end", async () =>
          resolve((await Promise.all(promises)).filter(Boolean)),
        );
      });
    });
  }

  async function getAppleResetLink(gmxEmail, gmxPassword) {
    log.mail(`Getting Apple reset link from ${config.IMAP.host}: ${gmxEmail}`);
    const { MAX_RETRIES, RETRY_DELAY } = config.MAIL_RETRY;
    const searchStart = new Date();

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      log.mail(`apple-reset-link attempt ${attempt}/${MAX_RETRIES}`);
      let imap = null;

      try {
        imap = await connectImap(gmxEmail, gmxPassword);
        const messages = await fetchInboxMessages(imap);
        log.mail(`Found ${messages.length} emails`);

        const bufferTime = new Date(searchStart.getTime() - 30000);
        const candidates = [];

        for (const m of messages) {
          if (!m) continue;
          const fromText = (m.from?.text || "").toLowerCase();
          const subject = (m.subject || "").toLowerCase();

          const isFromApple =
            fromText.includes("apple") ||
            fromText.includes("appleid") ||
            subject.includes("apple") ||
            subject.includes("reset your password") ||
            subject.includes("unlock");

          if (!isFromApple) continue;

          const date = new Date(m.date);
          if (date < bufferTime) continue;

          const content = (m.text || "") + " " + (m.html || "");
          const linkMatch = content.match(
            /https?:\/\/iforgot\.apple\.com\/verify\/email\?[^\s\]\)"<>']+/i,
          );

          if (linkMatch) {
            candidates.push({ date, link: linkMatch[0], subject: m.subject });
          }
        }

        imap.end();

        candidates.sort((a, b) => b.date - a.date);
        if (candidates.length > 0) {
          log.ok(`Found Apple reset link (subject: ${candidates[0].subject})`);
          return { resetLink: candidates[0].link };
        }

        log.warn("No Apple reset link found yet");
      } catch (err) {
        log.warn(`IMAP error: ${err.message}`);
        if (imap) try { imap.destroy(); } catch {}
      }

      if (attempt < MAX_RETRIES) {
        log.info(`Wait ${RETRY_DELAY / 1000}s...`);
        await delay(RETRY_DELAY);
      }
    }
    throw new Error("apple-reset-link: not found after retries");
  }

  return { getAppleResetLink };
}

module.exports = { createImapClient };
