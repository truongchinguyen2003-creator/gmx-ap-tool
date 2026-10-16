"use strict";

const fs = require("fs").promises;
const path = require("path");
const { log } = require("./utils");

function createFileIO(config) {
  // Đọc input: maillam|mailgmx|passgmx
  async function readInputList() {
    const content = await fs.readFile(config.PATHS.INPUT, "utf-8");
    const lines = content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && l.includes("|"));

    const entries = lines
      .map((l) => {
        const [mailLam = "", mailGmx = "", passGmx = ""] = l.split("|");
        return {
          mailLam: mailLam.trim(),
          mailGmx: mailGmx.trim(),
          passGmx: passGmx.trim(),
          raw: l,
        };
      })
      .filter((e) => e.mailLam && e.mailGmx && e.passGmx);

    log.info(`Loaded ${entries.length} email(s) from input`);
    return entries;
  }

  // Xóa 1 dòng khỏi input sau khi xử lý
  async function removeFromInput(rawLine) {
    try {
      const content = await fs.readFile(config.PATHS.INPUT, "utf-8");
      const lines = content.split("\n");
      const filtered = lines.filter((l) => l.trim() !== rawLine.trim());
      await fs.writeFile(config.PATHS.INPUT, filtered.join("\n"), "utf-8");
    } catch {}
  }

  // Ghi thành công: maillam|newPassword
  async function writeSuccess(entry, newPassword) {
    const line = `${entry.mailLam}|${newPassword}\n`;
    await fs.appendFile(config.PATHS.OUTPUT_SUCCESS, line, "utf-8");
    log.ok(`✅ Saved success: ${entry.mailLam}`);
  }

  // Ghi thất bại: maillam|mailgmx|passgmx|reason
  async function writeFailed(entry, reason) {
    const cleanReason = (reason || "")
      .replace(/\r?\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const line = `${entry.mailLam}|${entry.mailGmx}|${entry.passGmx}|${cleanReason}\n`;
    await fs.appendFile(config.PATHS.OUTPUT_FAILED, line, "utf-8");
    log.err(`Failed: ${entry.mailLam} - ${cleanReason}`);
  }

  return {
    readInputList,
    removeFromInput,
    writeSuccess,
    writeFailed,
  };
}

module.exports = { createFileIO };
