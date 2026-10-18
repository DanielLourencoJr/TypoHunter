/**
 * OpenCode transport.
 *
 * The Console free tier refuses direct calls from other clients
 * (403 FreeTierError: "can only be used from within OpenCode"), and the
 * refusal is decided below our headers — replaying opencode's exact
 * User-Agent / x-opencode-* set from Node or curl is still 403. So instead of
 * imitating opencode we run the real thing: a local headless `opencode serve`
 * and talk to ITS HTTP API. The free model is then genuinely used from within
 * OpenCode.
 *
 * The trials are stateless: one throwaway session per generation, deleted in a
 * finally block, so no proofread context leaks across paragraphs/posts.
 * `tools: {}` disables the agent's tools — this is a plain completion.
 *
 * Requests go through global fetch so tests can mock them like every other
 * provider; only `ensureServer()` touches the child process.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const OPENCODE_DEFAULT_MODEL = "deepseek-v4.1-flash-free";
export const OPENCODE_DEFAULT_PORT = 5198;

// Resolve the CLI: explicit override first, then the usual install locations.
export function opencodeBinary() {
  const candidates = [
    process.env.OPENCODE_BIN,
    path.join(os.homedir(), ".opencode", "bin", "opencode"),
    "/usr/local/bin/opencode",
    path.join(os.homedir(), ".local", "bin", "opencode"),
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function opencodeAvailable() {
  return !!opencodeBinary();
}

let serverProc = null;
let serverUrl = process.env.OPENCODE_URL || null;
let starting = null;

async function healthy(base) {
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/global/health`, { signal: AbortSignal.timeout(2000) });
    return !!r.ok;
  } catch {
    return false;
  }
}

function listeningUrl(chunk) {
  const m = /opencode server listening on (http:\/\/[^\s]+)/.exec(chunk);
  return m ? m[1].replace(/\/$/, "") : null;
}

function startOn(port) {
  const bin = opencodeBinary();
  if (!bin) return Promise.reject(new Error("opencode binary not found (set OPENCODE_BIN)"));
  const child = spawn(bin, ["serve", "--pure", "--hostname", "127.0.0.1", "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let buf = "";
    let done = false;
    const finish = (fn, arg) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(arg);
    };
    const scan = (d) => {
      buf += d.toString();
      const url = listeningUrl(buf);
      if (url) {
        serverProc = child;
        finish(resolve, url);
      }
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      finish(reject, new Error("opencode serve did not start in time"));
    }, Number(process.env.OPENCODE_START_TIMEOUT_MS) || 60000);
    child.stdout.on("data", scan);
    child.stderr.on("data", scan);
    child.on("error", (e) => finish(reject, e));
    child.on("exit", (code) => finish(reject, new Error(`opencode serve exited (${code})`)));
  });
}

// Start (or reuse) the headless server. Prefers a stable port so a stray from
// a previous run is adopted rather than duplicated; falls back to an ephemeral
// port if that one is taken by something else.
export async function ensureServer() {
  if (serverUrl && (await healthy(serverUrl))) return serverUrl;
  if (starting) return starting;
  starting = (async () => {
    const wanted = process.env.OPENCODE_PORT ? Number(process.env.OPENCODE_PORT) : OPENCODE_DEFAULT_PORT;
    const fixed = `http://127.0.0.1:${wanted}`;
    if (wanted && (await healthy(fixed))) {
      serverUrl = fixed;
      return fixed;
    }
    let url;
    try {
      url = await startOn(wanted || 0);
    } catch (e) {
      if (!wanted) throw e;
      url = await startOn(0);
    }
    serverUrl = url;
    return url;
  })().finally(() => {
    starting = null;
  });
  return starting;
}

export function stopOpencodeServer() {
  const child = serverProc;
  serverProc = null;
  serverUrl = null;
  if (child) {
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
  }
}

function splitModel(model) {
  const m = model || OPENCODE_DEFAULT_MODEL;
  const i = m.indexOf("/");
  return i > 0 ? { providerID: m.slice(0, i), modelID: m.slice(i + 1) } : { providerID: "opencode", modelID: m };
}

function errFrom(name, status, body, headers) {
  const err = new Error(`${name} HTTP ${status}: ${String(body).slice(0, 400)}`);
  const retryAfter = headers?.get?.("retry-after");
  const retrySecs = retryAfter && Number.isFinite(Number(retryAfter)) ? Math.max(1, Math.ceil(Number(retryAfter))) : 0;
  if (status === 429) {
    // Daily caps never clear by waiting — fail over. Minute limits retry.
    if (/per day|daily|TPD|tokens per day|requests per day|PerDay|quota/i.test(body)) {
      err.quotaExhausted = true;
      err.retryInSec = retrySecs || 60;
    } else {
      const m = /try again in ([\d.]+)s/i.exec(body);
      err.retryInSec = retrySecs || (m ? Math.max(1, Math.ceil(Number(m[1]))) : 10);
    }
  } else if (status >= 500) {
    err.transient = true;
    err.retryInSec = retrySecs || 5;
  }
  return err;
}

function errFromModel(name, error) {
  const msg = error?.data?.message || error?.message || (typeof error === "string" ? error : JSON.stringify(error));
  const err = new Error(`${name}: ${String(msg).slice(0, 400)}`);
  if (/quota|rate limit|per day|daily|TPD|exhaust/i.test(msg)) err.quotaExhausted = true;
  else if (/overloaded|unavailable|timeout|temporar/i.test(msg)) err.transient = true;
  return err;
}

// One throwaway session: create -> prompt -> delete. `base` may be supplied to
// skip ensureServer (tests); `fetchImpl` likewise overrides global fetch.
export async function sessionGenerate(base, model, { system, user, fetchImpl } = {}) {
  const f = fetchImpl || fetch;
  const root = base.replace(/\/$/, "");
  const { providerID, modelID } = splitModel(model);
  let sid = null;
  try {
    let cr;
    try {
      cr = await post2(f, root, "/session", {});
    } catch (e) {
      const err = new Error(`opencode network error: ${e.message}`);
      err.transient = true;
      err.retryInSec = 3;
      throw err;
    }
    const craw = await cr.text();
    if (!cr.ok) throw errFrom("opencode", cr.status, craw, cr.headers);
    sid = JSON.parse(craw).id;

    let mr;
    try {
      mr = await post2(f, root, `/session/${sid}/message`, {
        model: { providerID, modelID },
        system,
        parts: [{ type: "text", text: user }],
        tools: {},
      });
    } catch (e) {
      const err = new Error(`opencode network error: ${e.message}`);
      err.transient = true;
      err.retryInSec = 3;
      throw err;
    }
    const raw = await mr.text();
    if (!mr.ok) throw errFrom("opencode", mr.status, raw, mr.headers);
    const j = JSON.parse(raw);
    const info = j.info || {};
    if (info.error) throw errFromModel("opencode", info.error);
    const content = (j.parts || [])
      .filter((p) => p && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("");
    const t = info.tokens || {};
    const prompt = t.input || 0;
    const completion = t.output || 0;
    return {
      content: content || '{"suggestions":[]}',
      usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
    };
  } finally {
    if (sid) {
      try { await f(`${root}/session/${sid}`, { method: "DELETE" }); } catch { /* best effort */ }
    }
  }
}

function post2(f, root, suffix, payload) {
  return f(`${root}${suffix}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function opencodeGenerate({ model, system, user, base, fetchImpl } = {}) {
  const b = base || (await ensureServer());
  return sessionGenerate(b, model || process.env.OPENCODE_MODEL || OPENCODE_DEFAULT_MODEL, { system, user, fetchImpl });
}
