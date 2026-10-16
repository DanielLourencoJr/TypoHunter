#!/usr/bin/env node
// Larger OpenCode sweep. The free model is uncapped, so unlike the frugal
// gate (scripts/quality-gate.mjs) this can afford many paragraphs — but calls
// take ~15s each, so they run concurrently to keep wall time low.
//
// This test scores NO "correct"/"wrong" verdicts (nobody authoritative labelled
// the corpus): it only reports objective facts — did the model answer valid
// JSON, how many suggestions, how long, how many tokens — and dumps the edits
// so the author can judge them.
//
// Usage: node scripts/opencode-sweep.mjs [--limit 20] [--concurrency 5]
//        [--min-chars 200] [--out /tmp/opencode-sweep.json]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { maskOpaque, splitParagraphs, proofreadText } from "../lib/proofread.js";
import { opencodeProvider } from "../lib/llm.js";
import { stopOpencodeServer } from "../lib/opencode-server.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const CORPUS = path.join(ROOT, "testdata", "corpus", "posts");

// Deterministic even spread of `limit` paragraphs (>= minChars) across the
// corpus, so runs are comparable and "larger" is a knob, not a lottery.
export function selectParagraphs(items, { limit = 20, minChars = 200 } = {}) {
  const pool = items.filter((p) => (p.text || "").trim().length >= minChars);
  if (limit <= 0 || pool.length <= limit) return pool;
  const stride = pool.length / limit;
  const out = [];
  for (let i = 0; i < limit; i++) out.push(pool[Math.min(pool.length - 1, Math.floor(i * stride))]);
  return out;
}

const nearestRank = (sorted, p) => {
  if (!sorted.length) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
};

export function summarize(rows) {
  const ok = rows.filter((r) => r.ok);
  const lat = ok.map((r) => r.ms).sort((a, b) => a - b);
  const sum = (k) => rows.reduce((n, r) => n + (r[k] || 0), 0);
  return {
    n: rows.length,
    ok: ok.length,
    failed: rows.length - ok.length,
    jsonFail: ok.filter((r) => !r.jsonOk).length,
    withEdits: ok.filter((r) => r.suggestions > 0).length,
    suggestions: sum("suggestions"),
    tokens: sum("tokens"),
    avgMs: ok.length ? Math.round(lat.reduce((a, b) => a + b, 0) / ok.length) : 0,
    p50Ms: nearestRank(lat, 0.5),
    p95Ms: nearestRank(lat, 0.95),
  };
}

// Run `worker` over `items` with a bounded number in flight, preserving order.
export async function pool(items, worker, concurrency = 4) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length || 1)) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await worker(items[i], i);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

function loadCorpus() {
  const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith(".md")).sort();
  const items = [];
  for (const f of files) {
    const { masked } = maskOpaque(fs.readFileSync(path.join(CORPUS, f), "utf8"));
    for (const text of splitParagraphs(masked)) items.push({ post: f, text });
  }
  return items;
}

function opt(args, name, dflt) {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
}

async function main() {
  const args = process.argv.slice(2);
  const limit = Number(opt(args, "--limit", "20")) || 20;
  const concurrency = Number(opt(args, "--concurrency", "5")) || 5;
  const minChars = Number(opt(args, "--min-chars", "200")) || 200;
  const provider = opencodeProvider();

  const items = selectParagraphs(loadCorpus(), { limit, minChars });
  console.log(`opencode ${provider.model}: ${items.length} paragraphs, concurrency ${concurrency}`);

  const started = new Date().toISOString();
  const t0 = Date.now();
  let done = 0;
  const rows = await pool(
    items,
    async (it) => {
      const start = Date.now();
      let usage = null;
      let row;
      try {
        const r = await proofreadText(it.text, { provider, onUsage: (u) => { usage = u; } });
        row = {
          post: it.post, chars: it.text.length, ok: true, jsonOk: true,
          suggestions: r.suggestions.length, ms: Date.now() - start, tokens: usage?.total || 0,
          edits: r.suggestions.map((s) => `${s.original} → ${s.replacement}`),
        };
      } catch (e) {
        row = { post: it.post, chars: it.text.length, ok: false, jsonOk: false, suggestions: 0, ms: Date.now() - start, tokens: 0, error: e.message };
      }
      done++;
      process.stdout.write(`\r  ${done}/${items.length}`);
      return row;
    },
    concurrency,
  );
  process.stdout.write("\n");

  const s = summarize(rows);
  console.log(
    `ok ${s.ok}/${s.n} (${s.failed} failed), edits on ${s.withEdits}, ` +
    `${s.suggestions} suggestions, ${s.tokens} tokens, ` +
    `avg ${s.avgMs}ms p50 ${s.p50Ms}ms p95 ${s.p95Ms}ms, wall ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  for (const r of rows) {
    if (r.error) console.log(`  ERR  ${r.post}: ${r.error}`);
    else if (r.edits.length) console.log(`  ${r.suggestions}×  ${r.post}: ${r.edits.join(" | ").slice(0, 160)}`);
  }
  const out = opt(args, "--out", "/tmp/opencode-sweep.json");
  fs.writeFileSync(out, JSON.stringify({ model: provider.model, startedAt: started, wallMs: Date.now() - t0, summary: s, rows }, null, 2), "utf8");
  console.log(`wrote ${out}`);
}

function isDirectRun() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main()
    .catch((e) => { console.error("sweep failed:", e.message); process.exitCode = 1; })
    .finally(() => { stopOpencodeServer(); process.exit(); });
}
