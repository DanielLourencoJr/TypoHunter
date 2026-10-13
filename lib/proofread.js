/**
 * Minimal proofreader: constrained to typos / spelling / punctuation only.
 * - If GROQ_API_KEY is set, calls Groq OpenAI-compatible chat completions
 *   (default model openai/gpt-oss-120b).
 * - Otherwise runs a heuristic demo so the diff UI works offline.
 *
 * The review prompt lives in prompts/proofread.yaml (minimal-YAML subset,
 * parsed below — no deps) and is re-read on every analysis, so prompt edits
 * take effect without a server restart.
 *
 * Returns: [{ id, original, replacement, reason }]
 */

import fs from "node:fs";

function unquote(s) {
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

// Minimal YAML subset: top-level `key: value`, `key: |` literal blocks,
// `key:` followed by `- item` lists or one level of indented `sub: value`
// maps. Comments (`#`) and blank lines skipped. Throws with file/line on
// anything else — fail loud, never guess a prompt.
export function parsePromptYaml(src, file = "prompts/*.yaml") {
  const out = {};
  const lines = src.split(/\r?\n/);
  let i = 0;
  const fail = (msg) => { throw new Error(`${file}:${i + 1}: ${msg}`); };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) { i++; continue; }
    if (/^\s/.test(line)) fail("unexpected indentation (top-level keys only)");
    const m = /^([A-Za-z0-9_-]+):(?:\s+(.*))?$/.exec(line);
    if (!m) fail("expected `key: value`");
    const key = m[1];
    const rest = (m[2] || "").trim();
    if (rest === "|") {
      const buf = [];
      i++;
      while (i < lines.length && (!lines[i].trim() || /^\s/.test(lines[i]))) {
        buf.push(lines[i]);
        i++;
      }
      while (buf.length && !buf[buf.length - 1].trim()) buf.pop();
      const indent = buf.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length);
      const cut = indent.length ? Math.min(...indent) : 0;
      out[key] = buf.map((l) => (l.trim() ? l.slice(cut) : "")).join("\n");
    } else if (rest === "") {
      // Peek: `- item` lines form a list, `  sub: value` lines a map.
      let j = i + 1;
      while (j < lines.length && (!lines[j].trim() || lines[j].trimStart().startsWith("#"))) j++;
      const head = j < lines.length ? lines[j] : "";
      if (/^\s*-\s+/.test(head)) {
        const items = [];
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (!l.trim() || l.trimStart().startsWith("#")) { i++; continue; }
          const im = /^\s*-\s+(.*)$/.exec(l);
          if (!im) break;
          items.push(unquote(im[1].trim()));
          i++;
        }
        out[key] = items;
      } else if (/^\s+[A-Za-z0-9_-]+:\s+/.test(head)) {
        const map = {};
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (!l.trim() || l.trimStart().startsWith("#")) { i++; continue; }
          const im = /^\s+([A-Za-z0-9_-]+):\s+(.*)$/.exec(l);
          if (!im) break;
          map[im[1]] = unquote(im[2].trim());
          i++;
        }
        out[key] = map;
      } else {
        fail(`expected list or map under "${key}"`);
      }
    } else {
      out[key] = unquote(rest);
      i++;
    }
  }
  return out;
}

export function loadSystemPrompt() {
  const { system } = buildPrompt("proofread", {});
  return system;
}

const PROMPTS_DIR = new URL("../prompts/", import.meta.url);

function promptPath(name) {
  if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)?$/.test(name)) throw new Error(`bad prompt name "${name}"`);
  return new URL(`${name}.yaml`, PROMPTS_DIR);
}

function loadPromptDoc(name) {
  const file = promptPath(name);
  return parsePromptYaml(fs.readFileSync(file, "utf8"), `prompts/${name}.yaml`);
}

export function interpolate(tpl, data) {
  return String(tpl).replace(/\{([A-Za-z0-9_]+)\}/g, (m, k) =>
    data[k] === undefined || data[k] === null ? "" : String(data[k]));
}

// Composable prompt builder: system = includes (in order) + task's own
// system, joined by blank lines; `language_note` appended only when data
// carries a language. Content sections are every top-level string or
// string-list value except the structural keys below, in file order — so a
// base file can hold `system` plus a `rules` list and both reach the model.
// Every file is re-read per call — edits need no restart.
const STRUCTURAL_KEYS = new Set(["includes", "template", "language_note", "placeholder", "labels", "fallback"]);
function contentSections(doc) {
  const parts = [];
  for (const [k, v] of Object.entries(doc)) {
    if (STRUCTURAL_KEYS.has(k)) continue;
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) parts.push(...v.filter((x) => typeof x === "string"));
  }
  return parts;
}

export function composeSystem(doc, data = {}) {
  const parts = [];
  for (const inc of doc.includes || []) {
    for (const s of contentSections(loadPromptDoc(inc))) parts.push(interpolate(s, data));
  }
  if (doc.system) parts.push(interpolate(doc.system, data));
  if (data.language && doc.language_note) parts.push(interpolate(doc.language_note, data));
  return parts.map((s) => String(s).trim()).join("\n\n");
}

export function buildPrompt(name, data = {}) {
  const doc = loadPromptDoc(name);
  return { system: composeSystem(doc, data), doc };
}

const TYPO_MAP = [
  ["teh", "the", "typo"],
  ["recieve", "receive", "spelling"],
  ["seperate", "separate", "spelling"],
  ["occured", "occurred", "spelling"],
  ["dont", "don't", "punctuation"],
  ["cant", "can't", "punctuation"],
  ["wont", "won't", "punctuation"],
  ["its a", "it's a", "grammar"],
];

function heuristicProofread(md) {
  const suggestions = [];
  let n = 0;
  const push = (original, replacement, reason) => {
    n += 1;
    suggestions.push({ id: `h${n}`, original, replacement, reason });
  };

  // double spaces
  if (/[^ ]  +[^ ]/.test(md)) {
    // record one representative suggestion; apply step collapses all
    push("  (double space)", " (single space)", "whitespace");
  }
  for (const [from, to, reason] of TYPO_MAP) {
    const re = new RegExp(`\\b${from}\\b`, "i");
    if (re.test(md)) push(from, to, reason);
  }
  // repeated word: "the the"
  const rep = md.match(/\b(\w+)\s+\1\b/i);
  if (rep) push(rep[0], rep[1], "repeated word");
  return suggestions;
}

// Opaque round-trip markers must survive proofreading byte-identical: drop any
// suggestion whose match point falls inside one of these comment spans.

// Opaque markers are KBs of base64 — mask them to a short label before
// sending to the model (saves the bulk of prompt tokens on media-heavy
// texts and keeps chunks from splitting mid-marker). Suggestions are still
// validated against the ORIGINAL md, so masked placeholders can never match.
const OPAQUE_FULL_RE = /<!--\s*substack-cli-(?:node|inline):v1\s+([A-Za-z0-9_-]+)\s*-->/g;
export function maskOpaque(md) {
  // Placeholder wording lives in prompts/media.yaml (model-facing text
  // stays out of the code); re-read per call like the prompt itself.
  const media = loadPromptDoc("media");
  const fmt = media.placeholder || "[media {n}: {label}]";
  const labels = media.labels || {};
  const fallback = media.fallback || "media";
  let count = 0;
  const masked = md.replace(OPAQUE_FULL_RE, (whole, b64) => {
    count++;
    let type = fallback;
    try {
      type = JSON.parse(Buffer.from(b64, "base64").toString("utf8")).type || type;
    } catch {}
    return interpolate(fmt, { n: count, label: labels[type] || type });
  });
  return { masked, count };
}
const OPAQUE_RE = /<!--\s*substack-cli-(?:node|inline):v1\s+[A-Za-z0-9_-]+\s*-->/g;
function opaqueSpans(md) {
  const spans = [];
  let m;
  OPAQUE_RE.lastIndex = 0;
  while ((m = OPAQUE_RE.exec(md))) spans.push([m.index, m.index + m[0].length]);
  return spans;
}
function filterOpaque(md, suggestions) {
  if (!suggestions.length) return suggestions;
  const spans = opaqueSpans(md);
  if (!spans.length) return suggestions;
  const inSpan = (idx) => spans.some(([a, b]) => idx >= a && idx < b);
  return suggestions.filter((s) => {
    if (!s.original || s.original.includes("substack-cli")) return false;
    if (s.replacement.includes("substack-cli")) return false;
    const idx = md.indexOf(s.original);
    return idx === -1 ? true : !inSpan(idx);
  });
}

// Long inputs make the model lazy (returns [] on 12k chars that has typos).
// Split on paragraph boundaries so each call sees a short passage.
export function splitChunks(md, max = 3000) {
  const paras = md.split(/\n{2,}/);
  const chunks = [];
  let cur = "";
  for (const p of paras) {
    if (cur && (cur + "\n\n" + p).length > max) { chunks.push(cur); cur = p; }
    else cur = cur ? cur + "\n\n" + p : p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function proofreadChunk(text, { apiKey, model, system, user, onUsage, reasoningEffort }, chunkIdx) {
  // NOTE: no response_format json_object — gpt-oss on Groq rejects it
  // (json_validate_failed with empty generation). Prompt demands JSON-only
  // and the parser below tolerates fences/prose around the object.
  const body = {
    model: model || "openai/gpt-oss-120b",
    temperature: 0,
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user || text },
    ],
  };
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await r.text();
  if (!r.ok) {
    const err = new Error(`Groq HTTP ${r.status}: ${raw.slice(0, 400)}`);
    // parse retry hint from the FULL body (the sliced message may cut it off)
    const m = /try again in ([\d.]+)s/i.exec(raw);
    if (r.status === 429) err.retryInSec = m ? Math.max(1, Math.ceil(Number(m[1]))) : 10;
    throw err;
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("Groq: invalid JSON response");
  }
  if (onUsage && json.usage) {
    onUsage({ chunk: chunkIdx + 1, prompt: json.usage.prompt_tokens || 0,
      completion: json.usage.completion_tokens || 0, total: json.usage.total_tokens || 0 });
  }
  const content = json.choices?.[0]?.message?.content || '{"suggestions":[]}';
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    // tolerate fences or surrounding prose: extract the outer object
    const a = content.indexOf("{");
    const b = content.lastIndexOf("}");
    try {
      if (a === -1 || b <= a) throw new Error("no object");
      parsed = JSON.parse(content.slice(a, b + 1));
    } catch {
      throw new Error(`Groq: model did not return JSON (${content.slice(0, 120)})`);
    }
  }
  return (parsed.suggestions || []).slice(0, 30).map((s, i) => ({
    id: `ai${chunkIdx + 1}-${i + 1}`,
    original: String(s.original || "").slice(0, 200),
    replacement: String(s.replacement || "").slice(0, 200),
    reason: String(s.reason || "typo").slice(0, 40),
  })).filter((s) => s.original && s.replacement && s.original !== s.replacement);
}

export async function proofreadMarkdown(md, { apiKey, model, language, onUsage, reasoningEffort } = {}) {
  if (!apiKey) return { suggestions: filterOpaque(md, heuristicProofread(md)), mode: "heuristic" };

  const { system: SYSTEM_PROMPT, doc } = buildPrompt("proofread", { language }); // fresh every call
  const template = doc.template || "{text}";
  // No cap: every chunk of the FULL text is analyzed. Long texts take many
  // minutes (TPM pacing) — callers must treat this as a background job.
  // Opaque blobs are masked first (token savings + no mid-marker splits);
  // all validation below runs against the ORIGINAL md.
  const { masked, count: maskedCount } = maskOpaque(md);
  const chunks = masked.length > 3000 ? splitChunks(masked) : [masked];
  const modelName = model || "openai/gpt-oss-120b";
  const all = [];
  for (let c = 0; c < chunks.length; c++) {
    // Pace chunks so the TPM window slides; on 429 wait out THIS chunk and
    // retry it (up to 8 attempts ≈ several minutes) instead of failing the
    // whole analysis — a full restart would re-burn the tokens of the chunks
    // that already succeeded. Chunks are never skipped: it ends only when
    // every chunk has an answer or the budget is truly exhausted (then throw).
    if (c > 0) await sleep(3000);
    let found = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        found = await proofreadChunk(chunks[c], { apiKey, model: modelName, system: SYSTEM_PROMPT, user: interpolate(template, { text: chunks[c] }), onUsage, reasoningEffort }, c);
        break;
      } catch (e) {
        // 429: wait out the quota window. Truncated/non-JSON answer: retry —
        // reasoning length varies per attempt, a fresh run often fits.
        if (attempt >= 7) throw e;
        if (e.retryInSec) await sleep(e.retryInSec * 1000);
        else if (/^Groq: (model did not return JSON|invalid JSON)/.test(e.message)) await sleep(1000);
        else throw e;
      }
    }
    all.push(...found);
  }
  // Validity filter (server-side): drop suggestions whose anchor is not in
  // the text — the model sometimes returns near-matches that apply() could
  // never place. Also drop anything touching a URL (image links share
  // markdown syntax with their captions: ![alt](url "caption")). The UI
  // keeps its own stale-partition as a second net.
  const hasUrl = (s) => /https?:\/\//.test(s.original) || /https?:\/\//.test(s.replacement);
  const valid = all.filter((s) => !hasUrl(s) && md.includes(s.original));
  const suggestions = filterOpaque(md, valid).slice(0, 200);
  return { suggestions, mode: `ai:${modelName}${chunks.length > 1 ? `×${chunks.length}` : ""}${maskedCount ? `-${maskedCount}m` : ""}` };
}

export function applySuggestions(md, suggestions) {
  let out = md;
  let applied = 0;
  let skipped = 0;
  for (const s of suggestions) {
    if (s.original === "  (double space)") {
      if (/[^ ]  +[^ ]/.test(out)) {
        out = out.replace(/[^ ]  +[^ ]/g, (m) => m.replace(/  +/g, " "));
        applied++;
      } else {
        skipped++;
      }
      continue;
    }
    const idx = out.indexOf(s.original);
    if (idx === -1) {
      skipped++; // stale: already applied, overlapped, or text changed
      continue;
    }
    out = out.slice(0, idx) + s.replacement + out.slice(idx + s.original.length);
    applied++;
  }
  return { md: out, applied, skipped };
}
