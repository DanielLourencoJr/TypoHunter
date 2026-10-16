#!/usr/bin/env node
// Frugal quality gate: Groq vs Gemini (vs a local OpenCode free model, when
// the CLI is available) on a HAND-PICKED paragraph set — voice traps (must
// stay silent), a real typo (must catch), ordinary prose, plus the clean
// control (must return []). ~14-21 calls total: safe to run on a work day.
//
// Usage: node scripts/quality-gate.mjs [--pace 1500] [--out /tmp/gate.json]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../../SubstackCLI/lib/auth.js";
import {
  maskOpaque, splitParagraphs, proofreadText, promptVersion,
} from "../lib/proofread.js";
import { groqProvider, geminiProvider, opencodeProvider } from "../lib/llm.js";
import { opencodeAvailable } from "../lib/opencode-server.js";

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
  const ver = promptVersion(null);

  const arms = [];
  const groq = groqProvider();
  const gemini = geminiProvider();
  if (groq.key) arms.push(["groq", groq]);
  if (gemini.key) arms.push(["gemini", gemini]);
  if (opencodeAvailable()) arms.push(["opencode", opencodeProvider()]);
  if (!arms.length) throw new Error("no providers configured (keys or opencode CLI missing)");
  console.log(arms.map(([n, p]) => `${n}=${p.model}`).join(" "));

  const rows = [];
  for (const [file, anchor, label] of CASES) {
    const md = fs.readFileSync(path.join(ROOT, file), "utf8");
    const { masked } = maskOpaque(md);
    const para = splitParagraphs(masked).find((p) => p.includes(anchor));
    if (!para) throw new Error(`anchor not found: ${anchor}`);
    rows.push({ label, para });
  }
  rows.push({ label: "CLEAN CONTROL (must be [])", para: CLEAN_CONTROL });

  const res = {
    startedAt: new Date().toISOString(),
    models: Object.fromEntries(arms.map(([n, p]) => [n, p.model])),
    tokens: Object.fromEntries(arms.map(([n]) => [n, 0])),
    rows: [],
  };
  for (const row of rows) {
    const got = {};
    for (const [name, p] of arms) {
      let usage = null;
      const r = await proofreadText(row.para, {
        provider: p, system: ver.system, template: ver.template,
        onUsage: (u) => { usage = u; },
      });
      got[name] = r.suggestions;
      res.tokens[name] += usage?.total || 0;
      await sleep(pace);
    }
    res.rows.push({ label: row.label, para: row.para.slice(0, 120), ...got });
    const fmt = (ss) => ss.length ? ss.map((s) => `“${s.original}”→“${s.replacement}”`).join(" | ") : "[]";
    console.log(`\n### ${row.label}`);
    for (const [name] of arms) console.log(`  ${name.padEnd(8)} ${fmt(got[name])}`);
  }
  console.log(`\ntokens: ${arms.map(([n]) => `${n}=${res.tokens[n]}`).join(" ")}`);
  const out = opt("--out", "/tmp/gate.json");
  fs.writeFileSync(out, JSON.stringify(res, null, 2), "utf8");
  console.log(`wrote ${out}`);
}

main().catch((e) => { console.error("gate failed:", e.message); process.exit(1); });
