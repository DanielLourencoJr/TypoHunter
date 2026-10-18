#!/usr/bin/env node
// Verify a deployed TypoHunter from anywhere (no Substack reach needed — the
// Substack calls happen on the server). Checks deployment identity, the public
// contract, and optionally that the reviewer identity can still edit the
// configured test publication.
//
// Usage:
//   node scripts/verify-hosted.mjs --url https://typohunter.onrender.com
//   node scripts/verify-hosted.mjs --url ... --expect-commit 25f9220
//   node scripts/verify-hosted.mjs --url ... --deep      # needs REVIEWER_SID + SMOKE_PUB
//
// Exit code is non-zero if any check fails. Never prints secrets.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../lib/substack-cli/auth.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
loadEnvFile(path.join(ROOT, ".env"));

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
const flag = (name) => args.includes(name);

const url = String(opt("--url", process.env.HOSTED_URL || "https://typohunter.onrender.com")).replace(/\/+$/, "");
const expectCommit = String(opt("--expect-commit", ""));
const deep = flag("--deep");

let failures = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => { failures++; console.log(`  FAIL  ${m}`); };

async function main() {
  console.log(`Verifying ${url}`);

  let health;
  try {
    const r = await fetch(`${url}/api/health`, { headers: { Accept: "application/json" } });
    if (r.status !== 200) return fail(`/api/health -> HTTP ${r.status}`);
    health = await r.json();
  } catch (e) {
    return fail(`/api/health unreachable: ${String(e.message || e)}`);
  }
  pass(`/api/health ok (commit ${health.commit}, node ${health.node}, providers [${(health.providers || []).join(", ") || "none"}])`);
  if (expectCommit && health.commit !== expectCommit) fail(`commit ${health.commit} != expected ${expectCommit}`);
  else if (expectCommit) pass(`commit matches ${expectCommit}`);
  if (!health.deep) console.log("  note  deep edit-check not configured (SMOKE_PUB unset on the server)");

  const page = await fetch(url);
  const html = await page.text();
  if (page.status === 200 && html.includes("auth-screen-welcome")) pass("serves the TypoHunter app");
  else fail(`static app not served (HTTP ${page.status})`);

  const cfg = await fetch(`${url}/api/config`);
  if (cfg.status === 200 && typeof (await cfg.json()).reviewerEmail === "string") pass("/api/config public");
  else fail(`/api/config -> HTTP ${cfg.status}`);

  const me = await fetch(`${url}/api/me`);
  if (me.status === 401) pass("/api/me requires auth");
  else fail(`/api/me should be 401 anonymously, got ${me.status}`);

  if (deep) {
    const key = process.env.REVIEWER_SID || "";
    if (!key || !process.env.SMOKE_PUB) {
      fail("--deep needs REVIEWER_SID and SMOKE_PUB in .env");
    } else {
      const r = await fetch(`${url}/api/health/deep`, {
        method: "POST",
        headers: { "x-health-key": key, "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await r.json().catch(() => ({}));
      if (r.status === 200 && body.canEdit) pass(`reviewer can edit ${body.pub}`);
      else fail(`reviewer edit-check failed (HTTP ${r.status}${body.error ? `: ${body.error}` : ""})`);
    }
  }

  console.log(failures ? `FAILED (${failures})` : "OK");
  process.exitCode = failures ? 1 : 0;
}

main();
