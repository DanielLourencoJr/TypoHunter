import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  parsePromptYaml, interpolate, buildPrompt, promptVersion,
  maskOpaque, splitChunks, splitParagraphs, paraHash, sha256hex,
  partitionParagraphs, uniqueUnits, groupNewUnits,
  filterSuggestions, applySuggestions, attributeSuggestions,
  mergeLedgerSuggestions, reviewedPct, formatTarget,
  proofreadText, proofreadMarkdown, proofreadWithFailover,
} from "../lib/proofread.js";
import { groqProvider, geminiProvider, opencodeProvider } from "../lib/llm.js";

const originalFetch = globalThis.fetch;

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const rec = { url, body: opts?.body ? JSON.parse(opts.body) : null };
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

function llmReply(suggestions) {
  return resp({ body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ suggestions }) } }], usage: { total_tokens: 5, prompt_tokens: 3, completion_tokens: 2 } }) });
}

const NO_KEY = { name: "none", key: "", model: "m" };

// ---------------------------------------------------------------------------
// prompt YAML / composition
// ---------------------------------------------------------------------------

test("parsePromptYaml: scalars, quoting, block, list, map", () => {
  const src = [
    "# comment",
    "key: value",
    'quoted: "a: b"',
    "single: 'quoted'",
    "block: |",
    "  line1",
    "  line2",
    "",
    "list:",
    "  - a",
    '  - "b b"',
    "map:",
    "  x: 1",
    "  y: 2",
    "",
  ].join("\n");
  const out = parsePromptYaml(src, "t.yaml");
  assert.equal(out.key, "value");
  assert.equal(out.quoted, "a: b");
  assert.equal(out.single, "quoted");
  assert.equal(out.block, "line1\nline2");
  assert.deepEqual(out.list, ["a", "b b"]);
  assert.deepEqual(out.map, { x: "1", y: "2" });
});

test("parsePromptYaml: top-level indentation is an error", () => {
  assert.throws(() => parsePromptYaml("  bad: x", "p.yaml"), /p\.yaml:1: unexpected indentation/);
});

test("parsePromptYaml: malformed key errors with file:line", () => {
  assert.throws(() => parsePromptYaml("ok: 1\n- nope", "p.yaml"), /p\.yaml:2: expected `key: value`/);
});

test("interpolate: fills placeholders, blanks missing/null", () => {
  assert.equal(interpolate("hi {n}!", { n: "bob" }), "hi bob!");
  assert.equal(interpolate("{a}-{b}", { a: "x" }), "x-");
  assert.equal(interpolate("{a}", { a: null }), "");
});

test("buildPrompt: system is non-empty and language note is gated on language", () => {
  const plain = buildPrompt("proofread", {});
  assert.ok(plain.system.length > 0);
  assert.equal(typeof plain.doc.template, "string");
  const pt = buildPrompt("proofread", { language: "pt-BR" });
  assert.notEqual(pt.system, plain.system);
  assert.ok(pt.system.length > plain.system.length);
});

test("promptVersion: stable hash, tampered by language, template carried", () => {
  const a = promptVersion("");
  const b = promptVersion("");
  assert.equal(a.hash, b.hash);
  assert.match(a.hash, /^[0-9a-f]{64}$/);
  assert.equal(typeof a.template, "string");
  assert.notEqual(promptVersion("pt-BR").hash, a.hash);
});

// ---------------------------------------------------------------------------
// opaque markers
// ---------------------------------------------------------------------------

const markerFor = (obj) => `<!-- substack-cli-node:v1 ${Buffer.from(JSON.stringify(obj)).toString("base64url")} -->`;

test("maskOpaque: replaces marker, hides raw comment, counts", () => {
  const md = `before\n\n${markerFor({ type: "image" })}\n\nafter`;
  const { masked, count } = maskOpaque(md);
  assert.equal(count, 1);
  assert.ok(!masked.includes("substack-cli"));
  assert.match(masked, /\[media [0-9a-f]{8}: image\]/);
});

test("maskOpaque: placeholder id is content-hashed, stable under insertion", () => {
  const a = markerFor({ type: "image" });
  const b = markerFor({ type: "pdf" });
  const placeholders = (md) => [...md.matchAll(/\[media ([0-9a-f]{8}): [^\]]+\]/g)].map((m) => m[0]);
  const onlyA = placeholders(maskOpaque(a).masked);
  const bThenA = placeholders(maskOpaque(`${b}\n\n${a}`).masked);
  assert.equal(onlyA.length, 1);
  assert.equal(bThenA[1], onlyA[0], "inserting another marker must not renumber this one");
  assert.notEqual(bThenA[0], bThenA[1]);
});

// ---------------------------------------------------------------------------
// chunking + paragraph identity
// ---------------------------------------------------------------------------

test("splitChunks: single small chunk round-trips", () => {
  const md = "one\n\ntwo";
  assert.deepEqual(splitChunks(md), [md]);
});

test("splitChunks: respects max and re-joins to the original", () => {
  const p = "x".repeat(40);
  const md = [p, p, p].join("\n\n");
  const chunks = splitChunks(md, 85);
  assert.ok(chunks.length >= 2);
  for (const c of chunks) assert.ok(c.length <= 85 || !c.includes("\n\n"));
  assert.equal(chunks.join("\n\n"), md);
});

test("splitParagraphs: drops blank fragments, normalizes CRLF", () => {
  assert.deepEqual(splitParagraphs("a\n\nb\n\n\n\nc"), ["a", "b", "c"]);
  assert.deepEqual(splitParagraphs("a\r\n\r\nb"), ["a", "b"]);
  assert.deepEqual(splitParagraphs("   \n\n\t"), []);
});

test("paraHash: CRLF==LF, one extra space is a different paragraph", () => {
  assert.equal(paraHash("a\r\nb"), paraHash("a\nb"));
  assert.notEqual(paraHash("a"), paraHash("a "));
});

test("sha256hex: known vector", () => {
  assert.equal(sha256hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("partitionParagraphs: current vintage is entry-tagged, stale is new", () => {
  const md = "p1\n\np2";
  const ledger = { [paraHash("p1")]: { model: "m", promptHash: "H", suggestions: [] } };
  const fresh = partitionParagraphs(md, ledger, { models: ["m"], promptHash: "H" });
  assert.equal(fresh.units[0].entry.model, "m");
  assert.deepEqual(fresh.newUnits.map((u) => u.para), ["p2"]);
  const stale = partitionParagraphs(md, ledger, { models: ["other"], promptHash: "H" });
  assert.equal(stale.units[0].entry, null);
  assert.equal(stale.newUnits.length, 2);
});

test("partitionParagraphs: prompt/model change retires old verdicts", () => {
  const md = "p1";
  const ledger = { [paraHash("p1")]: { model: "m", promptHash: "OLD", suggestions: [] } };
  const { newUnits } = partitionParagraphs(md, ledger, { models: ["m"], promptHash: "NEW" });
  assert.equal(newUnits.length, 1);
});

test("uniqueUnits: dedupes identical hashes, keeps first occurrence", () => {
  const units = [{ para: "a", hash: "h" }, { para: "a", hash: "h" }, { para: "b", hash: "k" }];
  assert.deepEqual(uniqueUnits(units).map((u) => u.hash), ["h", "k"]);
});

test("groupNewUnits: packs adjacent units under max, dedupes duplicates", () => {
  const u = (s) => ({ para: s, hash: s });
  const two = groupNewUnits([u("aaaa"), u("bbbb"), u("cccc")], 12);
  assert.deepEqual(two.map((b) => b.length), [2, 1]);
  const one = groupNewUnits([u("a"), u("a"), u("b")], 3000);
  assert.deepEqual(one.map((b) => b.map((x) => x.para)), [["a", "b"]]);
});

// ---------------------------------------------------------------------------
// suggestion validity + application
// ---------------------------------------------------------------------------

test("filterSuggestions: keeps valid, drops no-op / url / absent / opaque-overlap", () => {
  const md = "the cat sat\n\n" + markerFor({ type: "image" });
  const b64 = md.match(/v1 ([A-Za-z0-9_-]+) -->/)[1];
  const inside = b64.slice(0, 14);
  const sugs = [
    { id: "1", original: "the", replacement: "The" },              // valid
    { id: "2", original: "cat", replacement: "cat" },              // no-op
    { id: "3", original: "sat", replacement: "see https://x.co" }, // url
    { id: "4", original: "absent", replacement: "here" },          // not in md
    { id: "5", original: inside, replacement: "Y" },               // inside opaque span
  ];
  const out = filterSuggestions(md, sugs);
  assert.deepEqual(out.map((s) => s.id), ["1"]);
});

test("filterSuggestions: overlapping spans keep the first", () => {
  const md = "the cat";
  const sugs = [
    { id: "1", original: "the", replacement: "The" },
    { id: "2", original: "he", replacement: "HE" },
  ];
  assert.deepEqual(filterSuggestions(md, sugs).map((s) => s.id), ["1"]);
});

test("applySuggestions: applies in order, collapses double spaces, counts stale", () => {
  const md = "teh  cat  sat";
  const r = applySuggestions(md, [
    { original: "teh", replacement: "the" },
    { original: "  (double space)", replacement: " (single space)" },
    { original: "gone", replacement: "x" },
  ]);
  assert.equal(r.md, "the cat sat");
  assert.equal(r.applied, 2);
  assert.equal(r.skipped, 1);
});

test("attributeSuggestions: maps anchor to the overlapping unit", () => {
  const units = [{ para: "alpha", hash: "h1" }, { para: "beta gamma", hash: "h2" }];
  const byHash = attributeSuggestions([{ original: "gamma", replacement: "Gamma" }], units, 0);
  assert.deepEqual(byHash.h1, []);
  assert.equal(byHash.h2.length, 1);
  assert.equal(byHash.h2[0].id, "ai1-1");
});

test("mergeLedgerSuggestions: document order, occurrence suffix for repeats", () => {
  const units = [{ para: "x", hash: "h" }, { para: "x", hash: "h" }];
  const ledger = { h: { model: "m", promptHash: "H", suggestions: [{ id: "s1", original: "x", replacement: "X" }] } };
  const out = mergeLedgerSuggestions(units, ledger, { models: ["m"], promptHash: "H" });
  assert.equal(out.length, 2);
  assert.equal(out[0].id, "s1");
  assert.equal(out[1].id, "s1#2");
});

test("reviewedPct: empty is 100%, half-covered is 50%", () => {
  assert.equal(reviewedPct("", {}, { models: [], promptHash: "H" }), 100);
  const md = "pp\n\nqq"; // 2 chars each
  const ledger = { [paraHash("pp")]: { model: "m", promptHash: "H" } };
  assert.equal(reviewedPct(md, ledger, { models: ["m"], promptHash: "H" }), 50);
});

test("formatTarget: no context passes through; context frames the target", () => {
  assert.equal(formatTarget("T"), "T");
  const framed = formatTarget("T", { before: "B", after: "A" });
  assert.match(framed, /CONTEXT \(read-only/);
  assert.match(framed, /TARGET \(proofread ONLY this paragraph\):\nT/);
});

// ---------------------------------------------------------------------------
// heuristic path (no keys)
// ---------------------------------------------------------------------------

test("proofreadText: no key => heuristic mode with mapped typos", async () => {
  const r = await proofreadText("teh recieve", { provider: NO_KEY });
  assert.equal(r.model, "heuristic");
  assert.equal(r.provider, "heuristic");
  const originals = r.suggestions.map((s) => s.original);
  assert.ok(originals.includes("teh"));
  assert.ok(originals.includes("recieve"));
});

test("proofreadMarkdown: no key => heuristic mode", async () => {
  const r = await proofreadMarkdown("teh cat  sat", { provider: NO_KEY });
  assert.equal(r.mode, "heuristic");
  assert.ok(r.suggestions.some((s) => s.original === "teh"));
});

// ---------------------------------------------------------------------------
// LLM path (mocked fetch)
// ---------------------------------------------------------------------------

test("proofreadText: returns serving model/provider/tokens and mapped ids", async () => {
  const { calls, restore } = mockFetch(() => llmReply([{ original: "teh", replacement: "the", reason: "typo" }]));
  try {
    const p = groqProvider({ key: "k", model: "mm" });
    const r = await proofreadText("teh cat", { providers: [p], system: "S", template: "{text}" });
    assert.equal(r.model, "mm");
    assert.equal(r.provider, "groq");
    assert.equal(r.tokens, 5);
    assert.equal(r.suggestions[0].id, "ai1-1");
    assert.equal(r.suggestions[0].original, "teh");
    assert.equal(calls[0].body.messages[0].content, "S");
  } finally { restore(); }
});

test("proofreadText: daily-cap on first provider fails over to the next", async () => {
  const { calls, restore } = mockFetch((rec) => {
    if (rec.url.includes("groq")) return resp({ ok: false, status: 429, body: "tokens per day (TPD)" });
    return llmReply([{ original: "teh", replacement: "the", reason: "typo" }]);
  });
  try {
    const order = [groqProvider({ key: "g", model: "gm" }), geminiProvider({ key: "m", model: "gemm" })];
    const r = await proofreadText("teh cat", { providers: order, system: "S", template: "{text}" });
    assert.equal(r.provider, "gemini");
    assert.equal(r.model, "gemm");
    assert.equal(calls.length, 2, "should not retry the exhausted provider");
  } finally { restore(); }
});

test("proofreadText: all providers exhausted => throws quota error", async () => {
  const { restore } = mockFetch(() => resp({ ok: false, status: 429, body: "requests per day exceeded" }));
  try {
    const order = [groqProvider({ key: "g" }), geminiProvider({ key: "m" })];
    await assert.rejects(proofreadText("teh", { providers: order, system: "S", template: "{text}" }),
      (e) => e.quotaExhausted === true);
  } finally { restore(); }
});

test("proofreadText: fatal 4xx rethrows and does not hammer the next provider", async () => {
  const { calls, restore } = mockFetch(() => resp({ ok: false, status: 401, body: "bad key" }));
  try {
    const order = [groqProvider({ key: "g" }), geminiProvider({ key: "m" })];
    await assert.rejects(proofreadText("teh", { providers: order, system: "S", template: "{text}" }), /HTTP 401/);
    assert.equal(calls.length, 1);
  } finally { restore(); }
});

test("proofreadText: opencode credential failure fails over, not fatal", async () => {
  const { calls, restore } = mockFetch((rec) => {
    if (rec.url.includes("/session")) return resp({ ok: false, status: 401, body: "unauthorized" });
    return llmReply([{ original: "teh", replacement: "the", reason: "typo" }]);
  });
  try {
    const order = [opencodeProvider({ base: "http://127.0.0.1:5198" }), groqProvider({ key: "g", model: "gm" })];
    const r = await proofreadText("teh cat", { providers: order, system: "S", template: "{text}" });
    assert.equal(r.provider, "groq");
    assert.equal(calls.length, 2, "opencode 401 should fail over without retrying");
  } finally { restore(); }
});

test("proofreadWithFailover: returns found + serving + tokens", async () => {
  const { restore } = mockFetch(() => llmReply([{ original: "a", replacement: "b" }]));
  try {
    const p = groqProvider({ key: "k", model: "mm" });
    const r = await proofreadWithFailover("a", { providers: [p], system: "S", template: "{text}" });
    assert.equal(r.serving.name, "groq");
    assert.equal(r.tokens, 5);
    assert.equal(r.found[0].original, "a");
  } finally { restore(); }
});

test("proofreadMarkdown: masks markers before the model, reports masked count", async () => {
  const md = `teh cat\n\n${markerFor({ type: "image" })}`;
  const { calls, restore } = mockFetch(() => llmReply([{ original: "teh", replacement: "the", reason: "typo" }]));
  try {
    const p = groqProvider({ key: "k", model: "mm" });
    const r = await proofreadMarkdown(md, { providers: [p] });
    assert.match(r.mode, /^ai:mm/);
    assert.match(r.mode, /-1m$/);
    const sent = calls[0].body.messages[1].content;
    assert.ok(!sent.includes("substack-cli"), "raw marker must never reach the model");
    assert.match(sent, /\[media [0-9a-f]{8}: image\]/);
    assert.equal(r.suggestions[0].original, "teh");
  } finally { restore(); }
});

afterEach(() => { globalThis.fetch = originalFetch; });
