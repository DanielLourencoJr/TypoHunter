/**
 * LLM provider abstraction (shared service keys — never user-supplied).
 *
 * Order: gemini first, groq as failover. The quality gate (scripts/
 * quality-gate.mjs, frozen text + clean control) showed Gemini 3.6 staying
 * silent on every voice trap across runs while Groq repeatedly "fixed"
 * correct prose (`uno`->`um`, `surtirem`->`surtir`). For a tool whose only
 * job is typos, a missed fix is safer than a wrong edit, so Gemini leads.
 * Groq keeps the better raw recall and covers Gemini's daily cap. Override
 * the order with LLM_ORDER.
 *
 * Provider: { name, baseURL, key, model }
 * All providers speak OpenAI-compatible chat completions; only the 429
 * shapes differ (parsed per provider below).
 */

export const GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b";
// Newest Gemini flash that answers reliably on our key (3.7/3.8 returned
// 503, 3.5-flash-lite 400). Verified better + ~2.5x cheaper than 2.5-flash.
export const GEMINI_DEFAULT_MODEL = "gemini-3.6-flash";

export function defaultModel() {
  return process.env.GROQ_MODEL || GROQ_DEFAULT_MODEL;
}

export function groqProvider({ key, model } = {}) {
  return {
    name: "groq",
    baseURL: "https://api.groq.com/openai/v1",
    key: key ?? process.env.GROQ_API_KEY ?? "",
    model: model ?? process.env.GROQ_MODEL ?? GROQ_DEFAULT_MODEL,
    supportsReasoningEffort: true,
  };
}

export function geminiProvider({ key, model } = {}) {
  return {
    name: "gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    key: key ?? process.env.GEMINI_API_KEY ?? "",
    model: model ?? process.env.GEMINI_MODEL ?? GEMINI_DEFAULT_MODEL,
    // Gemini's OpenAI-compat endpoint takes reasoning_effort (maps to a
    // thinking level). Typo-spotting needs no chain-of-thought, and thinking
    // tokens are billed + slow: "none" measured ~533 -> ~88 tokens/call.
    // Callers may override, but every default path uses the cheap setting.
    supportsReasoningEffort: true,
    defaultReasoningEffort: "none",
  };
}

const BUILDERS = { groq: groqProvider, gemini: geminiProvider };

// Ordered provider list from LLM_ORDER; only providers with a key present.
// Empty list = heuristic demo mode (no LLM configured).
export function providersFromEnv() {
  const order = (process.env.LLM_ORDER || "gemini,groq").split(",").map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const name of order) {
    const build = BUILDERS[name];
    if (!build) throw new Error(`unknown LLM provider "${name}" (want: groq,gemini)`);
    const p = build();
    if (p.key) out.push(p);
  }
  return out;
}

// Parse a Retry-After header (seconds, or HTTP date) into seconds.
function retryAfterSecs(headers) {
  const v = headers?.get?.("retry-after");
  if (!v) return 0;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(1, Math.ceil(n));
  const t = Date.parse(v);
  if (Number.isFinite(t)) return Math.max(1, Math.ceil((t - Date.now()) / 1000));
  return 0;
}

// Single chat-completions call. Resolves { content, usage }.
// Rejects with err.retryInSec (wait + retry same provider) and/or
// err.quotaExhausted (daily cap — do NOT retry, fail over instead) and/or
// err.transient (5xx/network — retry a little, then fail over).
export async function chatCompletion(provider, { system, user, reasoningEffort } = {}) {
  const body = {
    model: provider.model,
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  // NOTE: gpt-oss on Groq rejects response_format: json_object, so the
  // prompt demands JSON-only and the parser tolerates fences/prose.
  // A provider may declare a default effort (Gemini: "none" — no thinking);
  // an explicit caller value still wins.
  const effort = reasoningEffort ?? provider.defaultReasoningEffort;
  if (effort && provider.supportsReasoningEffort) body.reasoning_effort = effort;
  let r;
  try {
    r = await fetch(`${provider.baseURL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // DNS/TLS/reset/timeout — nothing was charged, another provider may work.
    const err = new Error(`${provider.name} network error: ${e.message}`);
    err.transient = true;
    err.retryInSec = 3;
    throw err;
  }
  const raw = await r.text();
  if (!r.ok) {
    const err = new Error(`${provider.name} HTTP ${r.status}: ${raw.slice(0, 400)}`);
    if (r.status === 429) {
      // Daily caps never clear by waiting: Groq names them ("tokens per
      // day", TPD); otherwise fall back to Retry-After / embedded hint.
      if (/per day|daily|TPD|tokens per day/i.test(raw)) {
        err.quotaExhausted = true;
        err.retryInSec = retryAfterSecs(r.headers) || 60;
      } else {
        const m = /try again in ([\d.]+)s/i.exec(raw);
        err.retryInSec = retryAfterSecs(r.headers) || (m ? Math.max(1, Math.ceil(Number(m[1]))) : 10);
      }
    } else if (r.status >= 500) {
      // Model overloaded / upstream hiccup — waiting helps, but not forever;
      // mark transient so the caller can fail over to another provider.
      err.transient = true;
      err.retryInSec = retryAfterSecs(r.headers) || 5;
    }
    throw err;
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`${provider.name}: invalid JSON response`);
  }
  return { content: json.choices?.[0]?.message?.content || '{"suggestions":[]}', usage: json.usage || null };
}
