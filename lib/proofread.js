/**
 * Minimal proofreader: constrained to typos / spelling / punctuation only.
 * - LLM calls go through lib/llm.js providers (OpenAI-compatible chat
 *   completions, ordered by LLM_ORDER, quota-exhausted fails over).
 * - Without any provider key, a heuristic demo runs so the diff UI works offline.
 *
 * The review prompt lives in prompts/proofread.yaml (minimal-YAML subset,
 * parsed below — no deps) and is re-read on every analysis, so prompt edits
 * take effect without a server restart.
 *
 * Returns: [{ id, original, replacement, reason, model }]
 */

import fs from "node:fs";
import { createHash } from "node:crypto";
import { chatCompletion, groqProvider, defaultModel } from "./llm.js";
export { defaultModel };

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
// Placeholder id is the hash of the marker bytes, NOT a sequential counter:
// inserting one image must not renumber (and thus re-identify) every marker
// after it. Identical markers hash identically wherever they sit, which is
// what keeps paragraph hashes stable under insertions.
export function maskOpaque(md) {
  // Placeholder wording lives in prompts/media.yaml (model-facing text
  // stays out of the code); re-read per call like the prompt itself.
  const media = loadPromptDoc("media");
  const fmt = media.placeholder || "[media {id}: {label}]";
  const labels = media.labels || {};
  const fallback = media.fallback || "media";
  let count = 0;
  const masked = md.replace(OPAQUE_FULL_RE, (whole, b64) => {
    count++;
    let type = fallback;
    try {
      type = JSON.parse(Buffer.from(b64, "base64").toString("utf8")).type || type;
    } catch {}
    const id = createHash("sha256").update(whole, "utf8").digest("hex").slice(0, 8);
    return interpolate(fmt, { n: id, id, label: labels[type] || type });
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

async function proofreadChunk(text, { provider, system, user, onUsage, reasoningEffort }, chunkIdx) {
  // NOTE: no response_format json_object — gpt-oss on Groq rejects it
  // (json_validate_failed with empty generation). Prompt demands JSON-only
  // and the parser below tolerates fences/prose around the object.
  const { content, usage } = await chatCompletion(provider, {
    system, user: user || text, reasoningEffort,
  });
  if (onUsage && usage) {
    onUsage({ chunk: chunkIdx + 1, prompt: usage.prompt_tokens || 0,
      completion: usage.completion_tokens || 0, total: usage.total_tokens || 0 });
  }
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
      throw new Error(`${provider.name}: model did not return JSON (${content.slice(0, 120)})`);
    }
  }
  return (parsed.suggestions || []).slice(0, 30).map((s, i) => ({
    id: `ai${chunkIdx + 1}-${i + 1}`,
    original: String(s.original || "").slice(0, 200),
    replacement: String(s.replacement || "").slice(0, 200),
    reason: String(s.reason || "typo").slice(0, 40),
  })).filter((s) => s.original && s.replacement && s.original !== s.replacement);
}

// One attempt at one provider: retryable errors (429-minute, 5xx/network,
// truncated JSON) retry up to 8 times; anything else throws immediately.
// After the retries, transient errors still propagate so the caller may
// fail over to another provider instead of failing the whole job.
async function attemptProvider(provider, text, { system, user, onUsage, reasoningEffort, chunkIdx = 0 }) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const found = await proofreadChunk(text, { provider, system, user, onUsage, reasoningEffort }, chunkIdx);
      return found;
    } catch (e) {
      if (e.quotaExhausted) throw e; // daily cap — fail over, never wait it out
      if (attempt >= 7) throw e;
      if (e.retryInSec) await sleep(e.retryInSec * 1000);
      else if (e.transient) await sleep(1000);
      else if (/model did not return JSON|invalid JSON response/.test(e.message)) await sleep(1000);
      else throw e;
    }
  }
}

function providersForCall({ provider, providers, apiKey, model } = {}) {
  if (provider) return [provider];
  if (providers?.length) return providers;
  // Legacy single-key callers (admin analyze, A/B scripts): Groq provider.
  return [groqProvider({ key: apiKey, model })];
}

export async function proofreadMarkdown(md, { apiKey, model, language, onUsage, reasoningEffort, provider, providers } = {}) {
  const list = providersForCall({ provider, providers, apiKey, model });
  if (!list[0]?.key) return { suggestions: filterSuggestions(md, heuristicProofread(md)), mode: "heuristic" };

  const { system: SYSTEM_PROMPT, doc } = buildPrompt("proofread", { language }); // fresh every call
  const template = doc.template || "{text}";
  // No cap: every chunk of the FULL text is analyzed. Long texts take many
  // minutes (TPM pacing) — callers must treat this as a background job.
  // Opaque blobs are masked first (token savings + no mid-marker splits);
  // all validation below runs against the ORIGINAL md.
  const { masked, count: maskedCount } = maskOpaque(md);
  const chunks = masked.length > 3000 ? splitChunks(masked) : [masked];
  const all = [];
  const served = new Set();
  for (let c = 0; c < chunks.length; c++) {
    // Pace chunks so the TPM window slides; on 429 wait out THIS chunk and
    // retry it instead of failing the whole analysis — a full restart would
    // re-burn the tokens of the chunks that already succeeded. Chunks are
    // never skipped: it ends only when every chunk has an answer or every
    // provider reports its daily cap exhausted (then throw).
    if (c > 0) await sleep(3000);
    const { found, serving } = await proofreadWithFailover(chunks[c], {
      providers: list, language, system: SYSTEM_PROMPT,
      user: interpolate(template, { text: chunks[c] }), onUsage, reasoningEffort,
      chunkIdx: c,
    });
    served.add(serving.model);
    all.push(...found);
  }
  // Validity filter shared with the ledger path (see filterSuggestions).
  const suggestions = filterSuggestions(md, all).slice(0, 200);
  const modelTag = [...served].join("+") || list[0].model;
  return { suggestions, mode: `ai:${modelTag}${chunks.length > 1 ? `×${chunks.length}` : ""}${maskedCount ? `-${maskedCount}m` : ""}` };
}

// Try each provider in order; quota-exhausted AND transient (5xx/network)
// errors fall over to the next provider — a 503 on the primary must not fail
// the job while a healthy provider is configured. Non-transient 4xx (bad
// key, bad request) are our fault: rethrow immediately, don't hammer.
// Returns { found, serving, tokens } where serving is the provider that
// answered and tokens is that call's total usage.
export async function proofreadWithFailover(text, { providers, language, system, template, user, onUsage, reasoningEffort, chunkIdx } = {}) {
  const list = providers?.length ? providers : providersForCall({});
  let quotaErr = null;
  let lastErr = null;
  for (const p of list) {
    if (!p.key) continue;
    const ver = system !== undefined ? { system, template: template || "{text}" } : promptVersion(language);
    let lastUsage = null;
    const tap = (u) => { lastUsage = u; if (onUsage) onUsage(u); };
    try {
      const found = await attemptProvider(p, text, {
        system: ver.system, user: user || interpolate(ver.template, { text }), onUsage: tap, reasoningEffort, chunkIdx,
      });
      return { found, serving: p, tokens: lastUsage?.total || 0 };
    } catch (e) {
      lastErr = e;
      if (e.quotaExhausted) { quotaErr = quotaErr || e; continue; }
      if (e.transient) continue; // overloaded/network — try the next provider
      throw e;
    }
  }
  throw quotaErr || lastErr || new Error("no LLM provider configured (missing keys?)");
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

// Edition-level validity filter (server-side): drop suggestions whose anchor
// is not in the text, anything touching a URL (image links share markdown
// syntax with captions), and anything overlapping an opaque marker span.
// Models sometimes emit two competing fixes for the same span (e.g. a double
// space reported both as "collapse the space" and as "pluralize the word").
// Applying both is impossible and offering both is confusing, so keep the
// first suggestion per non-overlapping span and drop the rest. Spans are
// located by first occurrence, matching how applySuggestions anchors them.
function dropOverlappingSpans(md, suggestions) {
  const kept = [];
  const spans = [];
  for (const s of suggestions) {
    const start = md.indexOf(s.original);
    if (start === -1) continue;
    const end = start + s.original.length;
    if (spans.some(([a, b]) => start < b && a < end)) continue;
    spans.push([start, end]);
    kept.push(s);
  }
  return kept;
}

export function filterSuggestions(md, suggestions) {
  const hasUrl = (s) => /https?:\/\//.test(s.original || "") || /https?:\/\//.test(s.replacement || "");
  const valid = (suggestions || []).filter(
    (s) => s.original && s.original !== s.replacement && !hasUrl(s) && md.includes(s.original),
  );
  return dropOverlappingSpans(md, filterOpaque(md, valid));
}

// ---------------------------------------------------------------------------
// Paragraph review ledger (silent, system-internal — never user-facing).
//
// Identity is the SHA-256 of the paragraph's RAW bytes. The ONLY normalization
// is CRLF -> LF (transport, not content): two paragraphs differing by even one
// space hash differently and are treated as different paragraphs. "Same
// paragraph" therefore means byte-identical — near-duplicates are re-proofread
// (accepted cost; fuzzy matching could wrongly reuse a verdict).
//
// A ledger entry is valid only for the exact {model, promptHash} vintage that
// produced it. A prompt or model change re-proofreads everything (lazily, one
// paragraph at a time, on the next proofread). Entries:
//   { suggestions: [...], model, promptHash, at, via: "llm"|"apply" }
// ---------------------------------------------------------------------------

export function sha256hex(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// Canonical paragraph splitter. MUST be the single splitter used by chunking,
// hashing and sync: masked marker labels contain no newlines, so masking never
// moves a boundary. Empty (whitespace-only) fragments carry no prose and are
// dropped — they need no review.
export function splitParagraphs(maskedMd) {
  return String(maskedMd || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .filter((p) => p.trim() !== "");
}

export function paraHash(para) {
  return sha256hex(String(para).replace(/\r\n/g, "\n"));
}

// Composed system prompt + template + language, with a hash. Any prompt-file
// edit changes the hash and (via the ledger vintage check) retires old
// verdicts. Re-read per call like everything else here — no restart needed.
export function promptVersion(language) {
  const { system, doc } = buildPrompt("proofread", { language });
  const template = doc.template || "{text}";
  const lang = language || "";
  const hash = sha256hex(system + "\n\x00\n" + template + "\n\x00\n" + lang);
  return { system, template, hash };
}

function entryIsCurrent(entry, vintage) {
  const models = vintage.models || (vintage.model ? [vintage.model] : []);
  return !!entry && models.includes(entry.model) && entry.promptHash === vintage.promptHash;
}

// Split the current text into units tagged with their ledger entry (if the
// entry matches the requested vintage). Insertions never change the identity
// of existing paragraphs: identity is content, not position.
export function partitionParagraphs(maskedMd, ledger, vintage) {
  const units = splitParagraphs(maskedMd).map((para) => {
    const hash = paraHash(para);
    const entry = entryIsCurrent(ledger?.[hash], vintage) ? ledger[hash] : null;
    return { para, hash, entry };
  });
  return { units, newUnits: units.filter((u) => !u.entry) };
}

// Group ADJACENT new units up to max chars per call. Never mixes reviewed +
// new text in one call (reviewed text is never re-sent). Identical paragraphs
// (same hash) are sent once per run; the verdict is attributed to every
// occurrence by content search.
// Same paragraph text may appear twice in one post (identical hash). It needs
// review once, and progress/estimates must count it once — both batch grouping
// and the heuristic path work on this deduped list.
export function uniqueUnits(units) {
  const seen = new Set();
  return (units || []).filter((u) => (seen.has(u.hash) ? false : (seen.add(u.hash), true)));
}

export function groupNewUnits(newUnits, max = 3000) {
  const batches = [];
  const sent = new Set();
  let cur = [];
  let len = 0;
  const flush = () => { if (cur.length) { batches.push(cur); cur = []; len = 0; } };
  for (const u of newUnits) {
    if (sent.has(u.hash)) continue; // duplicate occurrence — covered once
    const add = (cur.length ? 2 : 0) + u.para.length; // "\n\n" join
    if (cur.length && len + add > max) flush();
    cur.push(u);
    sent.add(u.hash);
    len += add;
  }
  flush();
  return batches;
}

// Single model call with failover across the ordered provider list.
// Returns { suggestions, model, provider, tokens }: model is the serving
// model id (recorded in the ledger vintage and shown in the UI header).
export async function proofreadText(text, { apiKey, model, language, system, template, onUsage, reasoningEffort, provider, providers } = {}) {
  const list = providersForCall({ provider, providers, apiKey, model });
  if (!list[0]?.key) {
    return { suggestions: filterSuggestions(text, heuristicProofread(text)), model: "heuristic", provider: "heuristic", tokens: 0 };
  }
  const { found, serving, tokens } = await proofreadWithFailover(text, {
    providers: list, language, system, template, onUsage, reasoningEffort,
  });
  return { suggestions: found, model: serving.model, provider: serving.name, tokens };
}

// Target + optional read-only neighbor context (A/B experiment). Context
// paragraphs are framed as untouchable; production sends no context until the
// A/B verdict lands.
export function formatTarget(text, context) {
  if (!context || (!context.before && !context.after)) return text;
  const parts = [];
  if (context.before) parts.push(`CONTEXT (read-only, do NOT proofread or mention):\n${context.before}`);
  parts.push(`TARGET (proofread ONLY this paragraph):\n${text}`);
  if (context.after) parts.push(`CONTEXT (read-only, do NOT proofread or mention):\n${context.after}`);
  return parts.join("\n\n");
}

// Attribute each suggestion to the covered unit(s) it overlaps, by locating
// the anchor in the joined batch text and mapping the char range back to unit
// offsets. Returns a plain object hash -> suggestions[] (re-id'ed per batch).
export function attributeSuggestions(suggestions, units, batchIdx) {
  const byHash = {};
  for (const u of units) byHash[u.hash] = [];
  const joined = units.map((u) => u.para).join("\n\n");
  const starts = [];
  let off = 0;
  for (const u of units) { starts.push(off); off += u.para.length + 2; }
  (suggestions || []).forEach((s, i) => {
    if (!s.original) return;
    const idx = joined.indexOf(s.original);
    if (idx === -1) return; // validity filter drops it later
    const end = idx + s.original.length;
    const rid = `ai${batchIdx + 1}-${i + 1}`;
    for (let k = 0; k < units.length; k++) {
      const us = starts[k];
      const ue = us + units[k].para.length;
      if (idx < ue && end > us) byHash[units[k].hash].push({ ...s, id: rid });
    }
  });
  return byHash;
}

// Merge ledger verdicts back into one edition-level suggestion list in
// document order (what the UI reads). Repeated occurrences each get the entry;
// ids stay unique via occurrence suffix.
export function mergeLedgerSuggestions(units, ledger, vintage) {
  const out = [];
  const seen = {};
  for (const u of units) {
    const entry = entryIsCurrent(ledger?.[u.hash], vintage) ? ledger[u.hash] : null;
    for (const s of entry?.suggestions || []) {
      const n = (seen[u.hash] = (seen[u.hash] || 0) + 1);
      out.push(n > 1 ? { ...s, id: `${s.id}#${n}` } : s);
    }
  }
  return out;
}

// Chars-weighted coverage of vintage-current verdicts over the current text.
// Basis for the per-article % in the library list.
export function reviewedPct(maskedMd, ledger, vintage) {
  const units = splitParagraphs(maskedMd);
  let total = 0;
  let done = 0;
  for (const para of units) {
    total += para.length;
    if (entryIsCurrent(ledger?.[paraHash(para)], vintage)) done += para.length;
  }
  if (!total) return 100;
  return Math.round((done / total) * 100);
}
