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
Return ONLY a JSON object, no markdown fences, no commentary: {"suggestions":[{"original":"exact substring","replacement":"fixed substring","reason":"typo|spelling|grammar|punctuation|whitespace"}]}
"original" must be a verbatim substring of the input (max 80 chars). Max 30 suggestions. Empty array if clean.`;

// Opaque round-trip markers must survive proofreading byte-identical: drop any
// suggestion whose match point falls inside one of these comment spans.
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

export async function proofreadMarkdown(md, { apiKey, model, language } = {}) {
  if (!apiKey) return { suggestions: filterOpaque(md, heuristicProofread(md)), mode: "heuristic" };

  const langLine = language ? `\nThe text is written in language "${language}". Apply that language's spelling/grammar rules; never convert it to another language.` : "";
  // NOTE: no response_format json_object — gpt-oss on Groq rejects it
  // (json_validate_failed with empty generation). Prompt demands JSON-only
  // and the parser below tolerates fences/prose around the object.
  const body = {
    model: model || "openai/gpt-oss-120b",
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_PROMPT + langLine },
      { role: "user", content: md.slice(0, 12000) },
    ],
  };
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) {
    const err = new Error(`Groq HTTP ${r.status}: ${text.slice(0, 400)}`);
    // parse retry hint from the FULL body (the sliced message may cut it off)
    const m = /try again in ([\d.]+)s/i.exec(text);
    if (r.status === 429) err.retryInSec = m ? Math.max(1, Math.ceil(Number(m[1]))) : 10;
    throw err;
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Groq: invalid JSON response");
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
  const suggestions = filterOpaque(md, (parsed.suggestions || []).slice(0, 30).map((s, i) => ({
    id: `ai${i + 1}`,
    original: String(s.original || "").slice(0, 200),
    replacement: String(s.replacement || "").slice(0, 200),
    reason: String(s.reason || "typo").slice(0, 40),
  })).filter((s) => s.original && s.replacement && s.original !== s.replacement));
  return { suggestions, mode: `ai:${body.model}` };
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
