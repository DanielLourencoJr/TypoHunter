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
Return JSON ONLY: {"suggestions":[{"original":"exact substring","replacement":"fixed substring","reason":"typo|spelling|grammar|punctuation|whitespace"}]}
"original" must be a verbatim substring of the input (max 80 chars). Max 30 suggestions. Empty array if clean.`;

export async function proofreadMarkdown(md, { apiKey, model } = {}) {
  if (!apiKey) return { suggestions: heuristicProofread(md), mode: "heuristic" };

  const body = {
    model: model || "openai/gpt-oss-120b",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: md.slice(0, 12000) },
    ],
  };
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Groq HTTP ${r.status}: ${text.slice(0, 400)}`);
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
    throw new Error("Groq: model did not return JSON");
  }
  const suggestions = (parsed.suggestions || []).slice(0, 30).map((s, i) => ({
    id: `ai${i + 1}`,
    original: String(s.original || "").slice(0, 200),
    replacement: String(s.replacement || "").slice(0, 200),
    reason: String(s.reason || "typo").slice(0, 40),
  })).filter((s) => s.original && s.replacement && s.original !== s.replacement);
  return { suggestions, mode: `ai:${body.model}` };
}

export function applySuggestions(md, suggestions) {
  let out = md;
  for (const s of suggestions) {
    if (s.original === "  (double space)") {
      out = out.replace(/[^ ]  +[^ ]/g, (m) => m.replace(/  +/g, " "));
      continue;
    }
    const idx = out.indexOf(s.original);
    if (idx !== -1) out = out.slice(0, idx) + s.replacement + out.slice(idx + s.original.length);
  }
  return out;
}
