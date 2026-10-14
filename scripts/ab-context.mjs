#!/usr/bin/env node
// A/B: solo paragraph vs paragraph + read-only neighbor context.
// Runs both arms over the FROZEN corpus (testdata/corpus) and reports
// agreement + token cost. Decides nothing by itself: disagreements are
// listed for human judgment; the winner is adopted in lib/proofread.js by hand.
//
// Usage:
//   node scripts/ab-context.mjs --dry-run            # mechanics only, no LLM
//   node scripts/ab-context.mjs --limit 3            # pilot: first 3 docs
//   node scripts/ab-context.mjs                      # full corpus (slow, background it)
//   node scripts/ab-context.mjs --max-paras 200 --pace 1500 --out testdata/ab.json
//
// GROQ_API_KEY / GROQ_MODEL from .env. One paragraph per call in BOTH arms
// (batching is orthogonal and identical for both, so it stays out).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../../SubstackCLI/lib/auth.js";
import {
  maskOpaque, splitParagraphs, proofreadText, formatTarget, defaultModel,
} from "../lib/proofread.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
loadEnvFile(path.join(ROOT, ".env"));

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
const flag = (name) => args.includes(name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (s) => `${s.original}\x00${s.replacement}\x00${s.reason}`;

async function main() {
  const dry = flag("--dry-run");
  const corpusDir = path.join(ROOT, "testdata", "corpus");
  const manifest = JSON.parse(fs.readFileSync(path.join(corpusDir, "manifest.json"), "utf8"));
  const limit = Number(opt("--limit", "0")) || 0;
  const maxParas = Number(opt("--max-paras", "0")) || 0;
  const pace = Number(opt("--pace", "1500")) || 0;
  const apiKey = process.env.GROQ_API_KEY || "";
  const model = process.env.GROQ_MODEL || defaultModel();
  if (!dry && !apiKey) throw new Error("GROQ_API_KEY missing");

  let docs = manifest.posts.flatMap((p) => p.files.map((f) => ({ ...f, postId: p.id })));
  if (limit) docs = docs.slice(0, limit);
  console.log(`docs=${docs.length} model=${model} pace=${pace}ms${dry ? " DRY-RUN" : ""}`);

  const res = {
    startedAt: new Date().toISOString(), model, arms: ["solo", "context"],
    paras: 0, agree: 0, disagree: [],
    sugSolo: 0, sugCtx: 0,
    tokens: { solo: 0, ctx: 0 },
    ms: 0,
  };
  const t0 = Date.now();
  let calls = 0;
  for (const d of docs) {
    const md = fs.readFileSync(path.join(corpusDir, d.file), "utf8");
    const { masked } = maskOpaque(md);
    const paras = splitParagraphs(masked);
    for (let i = 0; i < paras.length; i++) {
      if (maxParas && res.paras >= maxParas) break;
      res.paras++;
      if (dry) continue;
      const ctx = {
        before: i > 0 ? paras[i - 1] : "",
        after: i + 1 < paras.length ? paras[i + 1] : "",
      };
      const usage = { solo: null, ctx: null };
      // Sequential on purpose: protects the TPM budget; pacing between calls.
      const tA = Date.now();
      const sugA = await proofreadText(paras[i], {
        apiKey, model, onUsage: (u) => { usage.solo = u; },
      });
      await sleep(pace);
      const sugB = await proofreadText(formatTarget(paras[i], ctx), {
        apiKey, model, onUsage: (u) => { usage.ctx = u; },
      });
      await sleep(pace);
      calls += 2;
      res.tokens.solo += usage.solo?.total || 0;
      res.tokens.ctx += usage.ctx?.total || 0;
      res.sugSolo += sugA.length;
      res.sugCtx += sugB.length;
      const setA = new Set(sugA.map(key));
      const setB = new Set(sugB.map(key));
      const same = setA.size === setB.size && [...setA].every((k) => setB.has(k));
      if (same) {
        res.agree++;
      } else if (res.disagree.length < 300) {
        res.disagree.push({
          file: d.file, para: paras[i].slice(0, 160),
          soloOnly: sugA.filter((s) => !setB.has(key(s))),
          ctxOnly: sugB.filter((s) => !setA.has(key(s))),
          ms: Date.now() - tA,
        });
      }
    }
    if (maxParas && res.paras >= maxParas) break;
  }
  res.ms = Date.now() - t0;
  res.calls = calls;
  const agreePct = res.paras ? ((res.agree / res.paras) * 100).toFixed(1) : "—";
  console.log(`paras=${res.paras} agree=${res.agree} (${agreePct}%) ` +
    `sugSolo=${res.sugSolo} sugCtx=${res.sugCtx} ` +
    `tokSolo=${res.tokens.solo} tokCtx=${res.tokens.ctx} ` +
    `calls=${calls} ${(res.ms / 1000).toFixed(0)}s`);
  const out = path.resolve(ROOT, opt("--out", `testdata/ab-results-${Date.now()}.json`));
  fs.writeFileSync(out, JSON.stringify(res, null, 2), "utf8");
  console.log(`wrote ${out}`);
}

main().catch((e) => { console.error("ab failed:", e.message); process.exit(1); });
