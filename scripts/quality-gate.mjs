#!/usr/bin/env node
// Frugal quality gate: Groq vs Gemini on a HAND-PICKED paragraph set —
// voice traps (must stay silent), a real typo (must catch), ordinary prose,
// plus the clean control (must return []). ~16 calls total, ~15k tokens
// split across both providers: safe to run on a work day.
//
// Usage: node scripts/quality-gate.mjs [--pace 1500] [--out /tmp/gate.json]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../../SubstackCLI/lib/auth.js";
import {
  maskOpaque, splitParagraphs, proofreadText, promptVersion,
} from "../lib/proofread.js";
import { groqProvider, geminiProvider } from "../lib/llm.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
loadEnvFile(path.join(ROOT, ".env"));

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Paragraph selectors: [file, anchor substring, label]
const TRINDADE = "testdata/corpus/posts/177039177-a-santi-ssima-trindade-e-os-miste-rios-da-fe.md";
const CASES = [
  [TRINDADE, "uno", "voice-trap: 'uno' is correct theology"],
  [TRINDADE, "infalseáveis", "real typo: must catch"],
  [TRINDADE, "surtirem", "voice-trap: plural is correct"],
  ["testdata/corpus/posts/191119584-a-culpa-do-analfabetismo-funcional.md", "Raciocínio Lógico Matemático", "ordinary prose 1"],
  ["testdata/corpus/posts/191119584-a-culpa-do-analfabetismo-funcional.md", "Euclides se junta", "ordinary prose 2"],
];

const CLEAN_CONTROL = "O sol nasceu cedo naquela manhã de terça-feira. " +
  "As crianças atravessaram a rua com cuidado, de mãos dadas com a professora. " +
  "No fim da aula, cada aluno guardou o material na mochila e saiu em silêncio.";

async function main() {
  const pace = Number(opt("--pace", "1500")) || 0;
  const groq = groqProvider();
  const gemini = geminiProvider();
  if (!groq.key) throw new Error("GROQ_API_KEY missing");
  if (!gemini.key) throw new Error("GEMINI_API_KEY missing");
  const ver = promptVersion(null);
  console.log(`groq=${groq.model} gemini=${gemini.model}`);

  const rows = [];
  for (const [file, anchor, label] of CASES) {
    const md = fs.readFileSync(path.join(ROOT, file), "utf8");
    const { masked } = maskOpaque(md);
    const para = splitParagraphs(masked).find((p) => p.includes(anchor));
    if (!para) throw new Error(`anchor not found: ${anchor}`);
    rows.push({ label, para });
  }
  rows.push({ label: "CLEAN CONTROL (must be [])", para: CLEAN_CONTROL });

  const res = { startedAt: new Date().toISOString(), groq: groq.model, gemini: gemini.model, tokens: { groq: 0, gemini: 0 }, rows: [] };
  for (const row of rows) {
    const arms = {};
    for (const [name, p] of [["groq", groq], ["gemini", gemini]]) {
      let usage = null;
      const r = await proofreadText(row.para, {
        provider: p, system: ver.system, template: ver.template,
        onUsage: (u) => { usage = u; },
      });
      arms[name] = r.suggestions;
      res.tokens[name] += usage?.total || 0;
      await sleep(pace);
    }
    res.rows.push({ label: row.label, para: row.para.slice(0, 120), groq: arms.groq, gemini: arms.gemini });
    const fmt = (ss) => ss.length ? ss.map((s) => `“${s.original}”→“${s.replacement}”`).join(" | ") : "[]";
    console.log(`\n### ${row.label}\n  groq:   ${fmt(arms.groq)}\n  gemini: ${fmt(arms.gemini)}`);
  }
  console.log(`\ntokens: groq=${res.tokens.groq} gemini=${res.tokens.gemini}`);
  const out = opt("--out", "/tmp/gate.json");
  fs.writeFileSync(out, JSON.stringify(res, null, 2), "utf8");
  console.log(`wrote ${out}`);
}

main().catch((e) => { console.error("gate failed:", e.message); process.exit(1); });
