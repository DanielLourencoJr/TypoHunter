import fs from "node:fs";
import path from "node:path";

export function getArg(name, fallback = null) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

export function getAliasArg(long, short, fallback = null) {
  return getArg(long, getArg(short, fallback));
}

export function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

export function normalizeDir(p) {
  if (/^[a-zA-Z]:[^\\/]/.test(p)) {
    p = p.slice(0, 2) + "\\" + p.slice(2);
  }
  return path.resolve(p);
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function loadDotEnv(filePath = ".env") {
  if (!fs.existsSync(filePath)) return;
  const contents = fs.readFileSync(filePath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function nowStamp(date = new Date()) {
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeNewlines(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function slugSafe(slug, fallback) {
  return (slug || fallback || "untitled").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
}

export function yamlQuote(text) {
  const s = String(text ?? "");
  if (/[:#\[\]{}&*!|>'\"%@`,]|^\s|^\S*:\s|\n/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

export function escapeMd(text) {
  return String(text ?? "").replace(/[\\`*_[\]<>#|]/g, (m) => `\\${m}`);
}

// Notes-standard escaping (as used by notes_to_md.js): also escapes . - ( ) + ! > \
export function escapeMdNotes(text) {
  return String(text ?? "").replace(/[\\`*_{}[\]()#+\-.!|>]/g, (m) => `\\${m}`);
}

export function decodeEntities(text) {
  return String(text ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)));
}
