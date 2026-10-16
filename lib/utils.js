"use strict";

const fs = require("fs").promises;
const fsSync = require("fs");

// ════════════════════════════════════════════════════════════════════
// TIMING UTILITIES
// ════════════════════════════════════════
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Random delay trong khoảng [min, max] ms — dùng để giả lập human */
const randomDelay = (min, max) =>
  delay(Math.floor(Math.random() * (max - min + 1)) + min);

/** Random integer trong [min, max] inclusive */
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// ════════════════════════════════════════════════════════════════════
// PASSWORD GENERATOR
// ════════════════════════════════════════════════════════════════════
function generateRandomPassword(length = 18) {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const numbers = "0123456789";
  const symbol = "#";
  const pick = (s) => s[randInt(0, s.length - 1)];
  const required = [pick(upper), pick(lower), pick(numbers), symbol];
  const allChars = upper + lower + numbers + symbol;
  const rest = Array.from({ length: length - required.length }, () =>
    pick(allChars),
  );
  return [...required, ...rest].sort(() => Math.random() - 0.5).join("");
}

// ════════════════════════════════════════════════════════════════════
// TEXT EXTRACT HELPERS
// ════════════════════════════════════════════════════════════════════
const extractUsernameFromGreeting = (text) =>
  text.match(/Hi\s+([a-zA-Z0-9._-]+),/i)?.[1] || null;

const extractVerificationCode = (text, length = 6) =>
  text.match(new RegExp(`\\b\\d{${length}}\\b`))?.[0] || null;

// ════════════════════════════════════════════════════════════════════
// PATH HELPERS
// ════════════════════════════════════════════════════════════════════
function fileExistsSync(path) {
  try {
    return fsSync.existsSync(path);
  } catch {
    return false;
  }
}

// ════════════════════════════════════════════════════════════════════
// LOGGER — colored & prefixed
// ════════════════════════════════════════════════════════════════════
const log = {
  info: (m) => console.log(`ℹ️  ${m}`),
  ok: (m) => console.log(`✅ ${m}`),
  warn: (m) => console.log(`⚠️  ${m}`),
  err: (m) => console.error(`❌ ${m}`),
  step: (m) => console.log(`▶  ${m}`),
  mail: (m) => console.log(`📧 ${m}`),
  proxy: (m) => console.log(`🔐 ${m}`),
  ip: (m) => console.log(`🌐 ${m}`),
  mobile: (m) => console.log(`📱 ${m}`),
  desktop: (m) => console.log(`🖥️  ${m}`),
  divider: (label) =>
    console.log(`\n${"═".repeat(20)} ${label} ${"═".repeat(20)}`),
};

// ════════════════════════════════════════════════════════════════════
// CUSTOM ERRORS
// ════════════════════════════════════════════════════════════════════
class BotDetectedError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "BotDetectedError";
  }
}
class AccountNotFoundError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "AccountNotFoundError";
  }
}
class ProxyError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "ProxyError";
  }
}
class PhoneOnlyError extends Error {
  constructor(msg = "Code sent to phone — no email available") {
    super(msg);
    this.name = "PhoneOnlyError";
  }
}

module.exports = {
  delay,
  randomDelay,
  randInt,
  generateRandomPassword,
  extractUsernameFromGreeting,
  extractVerificationCode,
  fileExistsSync,
  log,
  BotDetectedError,
  AccountNotFoundError,
  ProxyError,
  PhoneOnlyError,
};
