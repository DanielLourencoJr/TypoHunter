#!/usr/bin/env node
// Prompt-format A/B on ONE representative text (default: analfabetismo essay).
// Arms (one paragraph per call in all arms):
//   solo        — baseline system prompt, paragraph alone
//   context     — baseline + read-only neighbor paragraphs
//   strict      — baseline + conservatism clause, paragraph alone
//   strict-ctx  — neighbors + conservatism clause
// Decides nothing by itself: prints agreement + full disagreements for human
// judgment against the author's standing preference (typos only, never voice).
//
// Usage:
//   node scripts/ab-prompts.mjs [--file <md>] [--variants solo,context,strict,strict-ctx]
//     [--pace 1500] [--out /tmp/ab-prompts.json]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../../SubstackCLI/lib/auth.js";
import {
  maskOpaque, splitParagraphs, proofreadText, formatTarget,
  promptVersion, defaultModel,
} from "../lib/proofread.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
loadEnvFile(path.join(ROOT, ".env"));

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (s) => `${s.original}\x00${s.replacement}\x00${s.reason}`;

// Candidate conservatism clause (NOT adopted — under test here).
const STRICT_CLAUSE = [
  "Conservatism rule: when in doubt, suggest nothing.",
  "Never replace a word with a synonym or a 'better' word — only fix what is",
  "objectively misspelled, ungrammatical, or mis-punctuated. Emphasis,",
  "repetition, register, and word choice are the author's voice, not errors.",
].join("\n");

async function main() {
  const apiKey = process.env.GROQ_API_KEY || "";
  if (!apiKey) throw new Error("GROQ_API_KEY missing");
  const model = process.env.GROQ_MODEL || defaultModel();
  const file = opt("--file", "testdata/corpus/posts/191119584-a-culpa-do-analfabetismo-funcional.md");
  const variants = (opt("--variants", "solo,context,strict,strict-ctx")).split(",").map((s) => s.trim()).filter(Boolean);
  const pace = Number(opt("--pace", "1500")) || 0;

  const md = fs.readFileSync(path.resolve(ROOT, file), "utf8");
  const { masked } = maskOpaque(md);
  const paras = splitParagraphs(masked);
  const ver = promptVersion(null);
  const systems = {
    solo: ver.system,
    context: ver.system,
    strict: ver.system + "\n\n" + STRICT_CLAUSE,
    "strict-ctx": ver.system + "\n\n" + STRICT_CLAUSE,
  };
  for (const v of variants) if (!systems[v]) throw new Error(`unknown variant ${v}`);
  console.log(`file=${file} paras=${paras.length} variants=${variants.join(",")} model=${model}`);

  const res = {
    startedAt: new Date().toISOString(), file, model, variants,
    strictClause: STRICT_CLAUSE, paras: [], tokens: {}, ms: 0,
  };
  for (const v of variants) res.tokens[v] = 0;
  const t0 = Date.now();
  for (let i = 0; i < paras.length; i++) {
    const ctx = { before: i > 0 ? paras[i - 1] : "", after: i + 1 < paras.length ? paras[i + 1] : "" };
    const row = { para: paras[i], arms: {} };
    for (const v of variants) {
      const useCtx = v === "context" || v === "strict-ctx";
      const text = useCtx ? formatTarget(paras[i], ctx) : paras[i];
      let usage = null;
      const sug = await proofreadText(text, {
        apiKey, model, system: systems[v], template: ver.template,
        onUsage: (u) => { usage = u; },
      });
      row.arms[v] = sug;
      res.tokens[v] += usage?.total || 0;
      await sleep(pace);
    }
    res.paras.push(row);
    if ((i + 1) % 5 === 0 || i + 1 === paras.length) console.log(`  ${i + 1}/${paras.length} paras`);
  }
  res.ms = Date.now() - t0;

  // Agreement: paras where ALL arms return identical suggestion sets.
  let agree = 0;
  const disagreements = [];
  for (const row of res.paras) {
    const sets = variants.map((v) => new Set(row.arms[v].map(key)));
    const all = new Set(sets.flatMap((s) => [...s]));
    const same = [...all].every((k) => sets.every((s) => s.has(k)));
    if (same) agree++;
    else disagreements.push(row);
  }
  console.log(`paras=${res.paras.length} full-agree=${agree} disagreed=${disagreements.length}`);
  for (const v of variants) {
    const n = res.paras.reduce((a, r) => a + r.arms[v].length, 0);
    console.log(`  ${v}: ${n} suggestions, ${res.tokens[v]} tokens`);
  }
  const out = path.resolve(ROOT, opt("--out", "/tmp/ab-prompts.json"));
  fs.writeFileSync(out, JSON.stringify(res, null, 2), "utf8");
  console.log(`wrote ${out} (${(res.ms / 1000).toFixed(0)}s)`);
}

main().catch((e) => { console.error("ab-prompts failed:", e.message); process.exit(1); });
