/**
 * LLM provider abstraction (shared service keys — never user-supplied).
 *
 * Order (default `opencode,gemini,groq`): OpenCode's free DeepSeek leads
 * because it is effectively uncapped, then Gemini, then Groq. The quality
 * gate (scripts/quality-gate.mjs, frozen text + clean control) prefers Gemini
 * on correctness — Groq repeatedly "fixed" correct prose (`uno`->`um`,
 * `surtirem`->`surtir`) and OpenCode once did too (`ensinado`->`ensinada`) —
 * but both Gemini (20-500 RPD) and Groq (TPD) have daily caps while OpenCode
 * does not, so OpenCode takes the bulk and Gemini/Groq cover its misses.
 * Override the order with LLM_ORDER.
 *
 * Provider: { name, baseURL, key, model }
 * All HTTP providers speak OpenAI-compatible chat completions; only the 429
 * shapes differ (parsed per provider below).
 *
 * OpenCode is special: its Console free tier only answers calls made from
 * within OpenCode, so instead of an HTTP endpoint the provider drives a local
 * headless `opencode serve` (see opencode-server.js). It has no key of its own
 * — availability is the presence of the CLI — and `kind: "opencode"` routes the
 * call to that transport.
 */

import { opencodeGenerate, opencodeAvailable, OPENCODE_DEFAULT_MODEL } from "./opencode-server.js";

export { OPENCODE_DEFAULT_MODEL };

export const GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b";
// Lite flash: 500 RPD free vs 20 RPD on the non-lite flash models (useless at
// ~4 posts/day). Measured same recall as 3.6-flash on ordinary typos, much
// slower, and blind to non-word errors — acceptable for a typos-only tool with
// groq failing over. 3.1-flash-lite is equal quality but spikes to ~38s/call.
export const GEMINI_DEFAULT_MODEL = "gemini-3.5-flash-lite";

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
  const m = model ?? process.env.GEMINI_MODEL ?? GEMINI_DEFAULT_MODEL;
  return {
    name: "gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    key: key ?? process.env.GEMINI_API_KEY ?? "",
    model: m,
    // Gemini's OpenAI-compat endpoint takes reasoning_effort (maps to a
    // thinking level). Typo-spotting needs no chain-of-thought, and thinking
    // tokens are billed + slow: "none" measured ~533 -> ~88 tokens/call.
    // The lite models reject "none" outright (503/400) — they need "low".
    supportsReasoningEffort: true,
    defaultReasoningEffort: /lite/.test(m) ? "low" : "none",
  };
}

const BUILDERS = { groq: groqProvider, gemini: geminiProvider };

export function opencodeProvider({ model, base } = {}) {
  return {
    name: "opencode",
    kind: "opencode",
    // Console free model, reached through a local `opencode serve`, never a
    // paid one. `model` may be "providerID/modelID" or a bare model id.
    model: model ?? process.env.OPENCODE_MODEL ?? OPENCODE_DEFAULT_MODEL,
    base: base ?? process.env.OPENCODE_URL,
    // No API key: the local server holds the Console credential. This sentinel
    // keeps the "configured provider has a key" checks honest; real gating is
    // the CLI's presence (see providersFromEnv).
    key: "opencode-local",
  };
}

// Ordered provider list from LLM_ORDER; only providers with a key present.
// OpenCode additionally requires its CLI (availability), so it drops out
// gracefully on machines without it. Empty list = heuristic demo mode.
export function providersFromEnv(deps = {}) {
  const order = (process.env.LLM_ORDER || "opencode,gemini,groq").split(",").map((s) => s.trim()).filter(Boolean);
  const available = deps.opencodeAvailable ?? opencodeAvailable;
  const out = [];
  for (const name of order) {
    const build = BUILDERS[name] || (name === "opencode" ? opencodeProvider : null);
    if (!build) throw new Error(`unknown LLM provider "${name}" (want: groq,gemini,opencode)`);
    if (name === "opencode" && !available()) continue;
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
  // OpenCode runs through a local `opencode serve`, not /chat/completions.
  if (provider.kind === "opencode") {
    return opencodeGenerate({ model: provider.model, system, user, base: provider.base });
  }
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
      // Classify on the FULL body, not the truncated message: the marker that
      // tells a per-day cap from a per-minute one sits late in the payload
      // (Gemini's quotaId "...PerDayPerProjectPerModel-FreeTier"; Groq's
      // "tokens per day (TPD)").
      // Daily/quota caps never clear by waiting — fail over instead of
      // retrying the same dead provider for minutes.
      if (/per day|daily|TPD|tokens per day|requests per day|PerDay/i.test(raw)) {
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
