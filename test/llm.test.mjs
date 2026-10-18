import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  GROQ_DEFAULT_MODEL, GEMINI_DEFAULT_MODEL, defaultModel,
  groqProvider, geminiProvider, providersFromEnv, chatCompletion,
  opencodeProvider, OPENCODE_DEFAULT_MODEL,
} from "../lib/llm.js";
import { sessionGenerate } from "../lib/opencode-server.js";

const ENV_KEYS = ["LLM_ORDER", "GROQ_API_KEY", "GEMINI_API_KEY", "GROQ_MODEL", "GEMINI_MODEL", "OPENCODE_MODEL", "OPENCODE_URL"];
const savedEnv = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const originalFetch = globalThis.fetch;

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const rec = { url, opts, body: opts?.body ? JSON.parse(opts.body) : null };
    calls.push(rec);
    return handler(rec, calls.length);
  };
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

function resp({ ok = true, status = 200, body = "", headers = {} } = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { ok, status, headers: { get: (k) => lower[String(k).toLowerCase()] ?? null }, async text() { return body; } };
}

test("groqProvider: defaults, baseURL, no default reasoning effort", () => {
  delete process.env.GROQ_MODEL;
  const p = groqProvider({ key: "k" });
  assert.equal(p.name, "groq");
  assert.equal(p.baseURL, "https://api.groq.com/openai/v1");
  assert.equal(p.model, GROQ_DEFAULT_MODEL);
  assert.equal(p.supportsReasoningEffort, true);
  assert.equal(p.defaultReasoningEffort, undefined);
});

test("groqProvider: explicit model and env model override default", () => {
  process.env.GROQ_MODEL = "env-model";
  assert.equal(groqProvider({ key: "k" }).model, "env-model");
  assert.equal(groqProvider({ key: "k", model: "arg-model" }).model, "arg-model");
});

test("geminiProvider: default model is the lite flash (500 RPD)", () => {
  delete process.env.GEMINI_MODEL;
  const p = geminiProvider({ key: "k" });
  assert.equal(p.model, GEMINI_DEFAULT_MODEL);
  assert.match(GEMINI_DEFAULT_MODEL, /lite/);
  assert.equal(p.baseURL, "https://generativelanguage.googleapis.com/v1beta/openai");
});

test("geminiProvider: lite models get reasoning_effort low, non-lite get none", () => {
  assert.equal(geminiProvider({ key: "k", model: "gemini-3.5-flash-lite" }).defaultReasoningEffort, "low");
  assert.equal(geminiProvider({ key: "k", model: "gemini-3.6-flash" }).defaultReasoningEffort, "none");
});

test("providersFromEnv: respects LLM_ORDER and drops keyless providers", () => {
  process.env.LLM_ORDER = "groq,gemini";
  process.env.GROQ_API_KEY = "g";
  process.env.GEMINI_API_KEY = "m";
  assert.deepEqual(providersFromEnv().map((p) => p.name), ["groq", "gemini"]);
  delete process.env.GEMINI_API_KEY;
  assert.deepEqual(providersFromEnv().map((p) => p.name), ["groq"]);
});

test("providersFromEnv: default order is opencode,gemini,groq (opencode gated by CLI)", () => {
  delete process.env.LLM_ORDER;
  process.env.GROQ_API_KEY = "g";
  process.env.GEMINI_API_KEY = "m";
  assert.deepEqual(providersFromEnv({ opencodeAvailable: () => true }).map((p) => p.name), ["opencode", "gemini", "groq"]);
  assert.deepEqual(providersFromEnv({ opencodeAvailable: () => false }).map((p) => p.name), ["gemini", "groq"]);
});

test("providersFromEnv: no keys => empty list (heuristic demo mode)", () => {
  delete process.env.LLM_ORDER;
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
  assert.deepEqual(providersFromEnv({ opencodeAvailable: () => false }), []);
});

test("providersFromEnv: unknown provider name throws", () => {
  process.env.LLM_ORDER = "groq,openai";
  process.env.GROQ_API_KEY = "g";
  assert.throws(() => providersFromEnv(), /unknown LLM provider/);
});

test("chatCompletion: request shape (model, temp 0, messages, authorization)", async () => {
  const { calls, restore } = mockFetch(() => resp({ body: JSON.stringify({ choices: [{ message: { content: "{}" } }] }) }));
  try {
    await chatCompletion(groqProvider({ key: "secret", model: "mm" }), { system: "SYS", user: "USR" });
    const c = calls[0];
    assert.equal(c.url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(c.opts.method, "POST");
    assert.equal(c.opts.headers.Authorization, "Bearer secret");
    assert.equal(c.body.model, "mm");
    assert.equal(c.body.temperature, 0);
    assert.deepEqual(c.body.messages, [{ role: "system", content: "SYS" }, { role: "user", content: "USR" }]);
    assert.equal("reasoning_effort" in c.body, false);
  } finally { restore(); }
});

test("chatCompletion: provider default effort applied, caller override wins", async () => {
  const { calls, restore } = mockFetch(() => resp({ body: JSON.stringify({ choices: [{ message: { content: "{}" } }] }) }));
  try {
    await chatCompletion(geminiProvider({ key: "k", model: "gemini-3.5-flash-lite" }), { system: "s", user: "u" });
    assert.equal(calls[0].body.reasoning_effort, "low");
    await chatCompletion(geminiProvider({ key: "k", model: "gemini-3.5-flash-lite" }), { system: "s", user: "u", reasoningEffort: "none" });
    assert.equal(calls[1].body.reasoning_effort, "none");
  } finally { restore(); }
});

test("chatCompletion: returns content and usage; missing usage tolerated", async () => {
  const { restore } = mockFetch(() => resp({ body: JSON.stringify({ choices: [{ message: { content: "hi" } }], usage: { total_tokens: 12 } }) }));
  try {
    const r = await chatCompletion(groqProvider({ key: "k" }), { user: "u" });
    assert.equal(r.content, "hi");
    assert.equal(r.usage.total_tokens, 12);
  } finally { restore(); }
});

test("chatCompletion: empty choices falls back to empty-suggestions JSON", async () => {
  const { restore } = mockFetch(() => resp({ body: JSON.stringify({}) }));
  try {
    const r = await chatCompletion(groqProvider({ key: "k" }), { user: "u" });
    assert.deepEqual(JSON.parse(r.content), { suggestions: [] });
  } finally { restore(); }
});

test("chatCompletion: 429 daily cap (TPD) => quotaExhausted", async () => {
  const { restore } = mockFetch(() => resp({ ok: false, status: 429, body: "Rate limit: tokens per day (TPD) exceeded" }));
  try {
    await assert.rejects(chatCompletion(groqProvider({ key: "k" }), { user: "u" }),
      (e) => e.quotaExhausted === true && e.retryInSec >= 1);
  } finally { restore(); }
});

test("chatCompletion: 429 Gemini PerDay quotaId => quotaExhausted (classified on full body)", async () => {
  const body = JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" }] }] } });
  const { restore } = mockFetch(() => resp({ ok: false, status: 429, body }));
  try {
    await assert.rejects(chatCompletion(geminiProvider({ key: "k" }), { user: "u" }),
      (e) => e.quotaExhausted === true);
  } finally { restore(); }
});

test("chatCompletion: 429 minute limit => retryInSec from body, not quotaExhausted", async () => {
  const { restore } = mockFetch(() => resp({ ok: false, status: 429, body: "Please try again in 5.5s" }));
  try {
    await assert.rejects(chatCompletion(groqProvider({ key: "k" }), { user: "u" }),
      (e) => !e.quotaExhausted && e.retryInSec === 6);
  } finally { restore(); }
});

test("chatCompletion: 429 Retry-After header wins (seconds)", async () => {
  const { restore } = mockFetch(() => resp({ ok: false, status: 429, body: "slow down", headers: { "retry-after": "30" } }));
  try {
    await assert.rejects(chatCompletion(groqProvider({ key: "k" }), { user: "u" }),
      (e) => !e.quotaExhausted && e.retryInSec === 30);
  } finally { restore(); }
});

test("chatCompletion: 429 Retry-After HTTP date parsed", async () => {
  const date = new Date(Date.now() + 20000).toUTCString();
  const { restore } = mockFetch(() => resp({ ok: false, status: 429, body: "wait", headers: { "retry-after": date } }));
  try {
    await assert.rejects(chatCompletion(groqProvider({ key: "k" }), { user: "u" }),
      (e) => e.retryInSec >= 1 && e.retryInSec <= 25);
  } finally { restore(); }
});

test("chatCompletion: 5xx => transient (not quota)", async () => {
  const { restore } = mockFetch(() => resp({ ok: false, status: 503, body: "overloaded" }));
  try {
    await assert.rejects(chatCompletion(groqProvider({ key: "k" }), { user: "u" }),
      (e) => e.transient === true && !e.quotaExhausted && e.retryInSec >= 1);
  } finally { restore(); }
});

test("chatCompletion: network failure => transient", async () => {
  const { restore } = mockFetch(() => { throw new Error("ECONNRESET"); });
  try {
    await assert.rejects(chatCompletion(groqProvider({ key: "k" }), { user: "u" }),
      (e) => e.transient === true && e.retryInSec === 3 && /network error/.test(e.message));
  } finally { restore(); }
});

test("chatCompletion: 4xx (bad key) is fatal — no retry/quota flags", async () => {
  const { restore } = mockFetch(() => resp({ ok: false, status: 401, body: "invalid api key" }));
  try {
    await assert.rejects(chatCompletion(groqProvider({ key: "bad" }), { user: "u" }),
      (e) => !e.quotaExhausted && !e.transient && e.retryInSec === undefined);
  } finally { restore(); }
});

test("chatCompletion: non-JSON 200 body throws invalid JSON", async () => {
  const { restore } = mockFetch(() => resp({ body: "<html>oops</html>" }));
  try {
    await assert.rejects(chatCompletion(groqProvider({ key: "k" }), { user: "u" }), /invalid JSON response/);
  } finally { restore(); }
});

test("defaultModel: env override, else Groq default", () => {
  delete process.env.GROQ_MODEL;
  assert.equal(defaultModel(), GROQ_DEFAULT_MODEL);
  process.env.GROQ_MODEL = "custom";
  assert.equal(defaultModel(), "custom");
});

// ---- OpenCode provider (local `opencode serve` transport) ----

test("opencodeProvider: no key, kind=opencode, free default model", () => {
  delete process.env.OPENCODE_MODEL;
  delete process.env.OPENCODE_URL;
  const p = opencodeProvider();
  assert.equal(p.name, "opencode");
  assert.equal(p.kind, "opencode");
  assert.equal(p.model, OPENCODE_DEFAULT_MODEL);
  assert.match(OPENCODE_DEFAULT_MODEL, /-free$/);
  assert.equal(p.base, undefined);
  assert.ok(p.key);
});

test("opencodeProvider: env + explicit model override", () => {
  process.env.OPENCODE_MODEL = "env-model";
  assert.equal(opencodeProvider().model, "env-model");
  assert.equal(opencodeProvider({ model: "arg-model" }).model, "arg-model");
});

test("providersFromEnv: opencode included only when the CLI is available", () => {
  process.env.LLM_ORDER = "opencode,groq";
  process.env.GROQ_API_KEY = "g";
  assert.deepEqual(providersFromEnv({ opencodeAvailable: () => false }).map((p) => p.name), ["groq"]);
  assert.deepEqual(providersFromEnv({ opencodeAvailable: () => true }).map((p) => p.name), ["opencode", "groq"]);
});

test("chatCompletion: opencode dispatches to a throwaway session", async () => {
  const { calls, restore } = mockFetch((rec) => {
    if (rec.url.endsWith("/session")) return resp({ body: JSON.stringify({ id: "ses_x" }) });
    if (rec.url.endsWith("/session/ses_x/message"))
      return resp({ body: JSON.stringify({ info: { tokens: { input: 5, output: 3 } }, parts: [{ type: "text", text: '{"suggestions":[]}' }] }) });
    return resp({ body: "{}" });
  });
  try {
    const p = opencodeProvider({ base: "http://127.0.0.1:5198" });
    const r = await chatCompletion(p, { system: "SYS", user: "USR" });
    assert.equal(r.content, '{"suggestions":[]}');
    assert.equal(r.usage.total_tokens, 8);
    const msg = calls.find((c) => c.url.endsWith("/message"));
    assert.deepEqual(msg.body.model, { providerID: "opencode", modelID: OPENCODE_DEFAULT_MODEL });
    assert.equal(msg.body.system, "SYS");
    assert.deepEqual(msg.body.parts, [{ type: "text", text: "USR" }]);
    assert.deepEqual(msg.body.tools, {});
    assert.ok(calls.some((c) => c.opts.method === "DELETE" && c.url.endsWith("/session/ses_x")));
  } finally { restore(); }
});

test("sessionGenerate: model field selects providerID/modelID when prefixed", async () => {
  const { calls, restore } = mockFetch((rec) => {
    if (rec.url.endsWith("/session")) return resp({ body: JSON.stringify({ id: "ses_y" }) });
    return resp({ body: JSON.stringify({ info: {}, parts: [] }) });
  });
  try {
    await sessionGenerate("http://127.0.0.1:5198", "acme/fast-model", { system: "s", user: "u" });
    const msg = calls.find((c) => c.url.endsWith("/message"));
    assert.deepEqual(msg.body.model, { providerID: "acme", modelID: "fast-model" });
  } finally { restore(); }
});

test("sessionGenerate: no text parts falls back to empty-suggestions JSON", async () => {
  const { restore } = mockFetch((rec) => {
    if (rec.url.endsWith("/session")) return resp({ body: JSON.stringify({ id: "ses_z" }) });
    return resp({ body: JSON.stringify({ info: {}, parts: [] }) });
  });
  try {
    const r = await sessionGenerate("http://127.0.0.1:5198", "m", { system: "s", user: "u" });
    assert.deepEqual(JSON.parse(r.content), { suggestions: [] });
    assert.equal(r.usage.total_tokens, 0);
  } finally { restore(); }
});

test("sessionGenerate: assistant error mentioning quota => quotaExhausted", async () => {
  const { restore } = mockFetch((rec) => {
    if (rec.url.endsWith("/session")) return resp({ body: JSON.stringify({ id: "ses_q" }) });
    return resp({ body: JSON.stringify({ info: { error: { data: { message: "quota exceeded: requests per day" } } }, parts: [] }) });
  });
  try {
    await assert.rejects(sessionGenerate("http://127.0.0.1:5198", "m", { system: "s", user: "u" }),
      (e) => e.quotaExhausted === true);
  } finally { restore(); }
});

test("sessionGenerate: 5xx on prompt => transient", async () => {
  const { restore } = mockFetch((rec) => {
    if (rec.url.endsWith("/session")) return resp({ body: JSON.stringify({ id: "ses_t" }) });
    return resp({ ok: false, status: 503, body: "overloaded" });
  });
  try {
    await assert.rejects(sessionGenerate("http://127.0.0.1:5198", "m", { system: "s", user: "u" }),
      (e) => e.transient === true && !e.quotaExhausted);
  } finally { restore(); }
});

test("sessionGenerate: network failure => transient", async () => {
  const { restore } = mockFetch(() => { throw new Error("ECONNRESET"); });
  try {
    await assert.rejects(sessionGenerate("http://127.0.0.1:5198", "m", { system: "s", user: "u" }),
      (e) => e.transient === true && e.retryInSec === 3 && /network error/.test(e.message));
  } finally { restore(); }
});

test("sessionGenerate: 401 => failover (missing hosted credential), not fatal", async () => {
  const { restore } = mockFetch((rec) => {
    if (rec.url.endsWith("/session")) return resp({ body: JSON.stringify({ id: "ses_a" }) });
    return resp({ ok: false, status: 401, body: "unauthorized" });
  });
  try {
    await assert.rejects(sessionGenerate("http://127.0.0.1:5198", "m", { system: "s", user: "u" }),
      (e) => e.failover === true && !e.quotaExhausted && !e.transient);
  } finally { restore(); }
});
