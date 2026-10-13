/**
 * Minimal proofreader: constrained to typos / spelling / punctuation only.
 * - If GROQ_API_KEY is set, calls Groq OpenAI-compatible chat completions
 *   (default model openai/gpt-oss-120b).
 * - Otherwise runs a heuristic demo so the diff UI works offline.
 *
 * Returns: [{ id, original, replacement, reason }]
 */

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

const SYSTEM_PROMPT = `You are a conservative proofreader for Substack posts.
Fix ONLY: typos, spelling, grammar, punctuation, capitalization, repeated words, double spaces.
Do NOT change word choice, sentence structure, rhythm, voice, tone, or meaning.
If unsure, leave it alone. Never rewrite sentences for style.
CRITICAL: the text contains HTML comments like <!-- substack-cli-node:v1 ... --> and <!-- substack-cli-inline:v1 ... -->. These are machine round-trip markers for embeds/media. NEVER include them in any "original", NEVER modify/split/remove them, NEVER emit them in any "replacement". Only propose fixes in human-readable prose.
Placeholders like "[midia 3: post incorporado]" stand for embeds (images, files, buttons, quotes). They are not prose: NEVER include them in any "original" either.
Image captions arrive as ![alt](url "caption"): you MAY fix the caption words, but NEVER touch URLs, filenames, or markdown syntax.
Return ONLY a JSON object, no markdown fences, no commentary: {"suggestions":[{"original":"exact substring","replacement":"fixed substring","reason":"typo|spelling|grammar|punctuation|whitespace"}]}
"original" must be a verbatim substring of the input (max 80 chars). Max 30 suggestions. Empty array if clean.`;

// Opaque markers are KBs of base64 — mask them to a short label before
// sending to the model (saves the bulk of prompt tokens on media-heavy
// texts and keeps chunks from splitting mid-marker). Suggestions are still
// validated against the ORIGINAL md, so masked placeholders can never match.
const OPAQUE_FULL_RE = /<!--\s*substack-cli-(?:node|inline):v1\s+([A-Za-z0-9_-]+)\s*-->/g;
const MARKER_LABEL = {
  embeddedPost: "post incorporado", digestPostEmbed: "post incorporado",
  pullquote: "citacao em destaque", button: "botao", image: "imagem",
  pdf: "PDF", footnote: "nota de rodape", youtube2: "video",
  subscribeWidget: "botao de inscricao", callout: "destaque", calloutBlock: "destaque",
  substack_mentions: "mencao",
};
export function maskOpaque(md) {
  let count = 0;
  const masked = md.replace(OPAQUE_FULL_RE, (whole, b64) => {
    count++;
    let type = "midia";
    try {
      type = JSON.parse(Buffer.from(b64, "base64").toString("utf8")).type || type;
    } catch {}
    return `[midia ${count}: ${MARKER_LABEL[type] || type}]`;
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

async function proofreadChunk(text, { apiKey, model, langLine, onUsage, reasoningEffort }, chunkIdx) {
  // NOTE: no response_format json_object — gpt-oss on Groq rejects it
  // (json_validate_failed with empty generation). Prompt demands JSON-only
  // and the parser below tolerates fences/prose around the object.
  const body = {
    model: model || "openai/gpt-oss-120b",
    temperature: 0,
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    messages: [
      { role: "system", content: SYSTEM_PROMPT + langLine },
      { role: "user", content: text },
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

  const langLine = language ? `\nThe text is written in language "${language}". Apply that language's spelling/grammar rules; never convert it to another language.` : "";
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
        found = await proofreadChunk(chunks[c], { apiKey, model: modelName, langLine, onUsage, reasoningEffort }, c);
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
