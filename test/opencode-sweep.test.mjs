import test from "node:test";
import assert from "node:assert/strict";
import { selectParagraphs, summarize, pool } from "../scripts/opencode-sweep.mjs";

const long = (n) => "x".repeat(n);

test("selectParagraphs: filters by minChars", () => {
  const items = [{ post: "a", text: "short" }, { post: "b", text: long(300) }];
  assert.deepEqual(selectParagraphs(items, { limit: 5, minChars: 200 }).map((p) => p.post), ["b"]);
});

test("selectParagraphs: spreads evenly across the pool (deterministic)", () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ post: `p${i}`, text: long(300) }));
  assert.deepEqual(selectParagraphs(items, { limit: 3 }).map((p) => p.post), ["p0", "p3", "p6"]);
});

test("selectParagraphs: returns whole pool when it fits the limit", () => {
  const items = Array.from({ length: 4 }, (_, i) => ({ post: `p${i}`, text: long(300) }));
  assert.equal(selectParagraphs(items, { limit: 10 }).length, 4);
});

test("selectParagraphs: limit <= 0 keeps every eligible paragraph", () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ post: `p${i}`, text: long(300) }));
  assert.equal(selectParagraphs(items, { limit: 0 }).length, 5);
});

test("summarize: counts, edit detection, tokens, and nearest-rank percentiles", () => {
  const rows = [
    { ok: true, jsonOk: true, suggestions: 2, ms: 100, tokens: 10 },
    { ok: true, jsonOk: true, suggestions: 0, ms: 200, tokens: 20 },
    { ok: true, jsonOk: false, suggestions: 0, ms: 300, tokens: 30 },
    { ok: false, jsonOk: false, suggestions: 0, ms: 400, tokens: 0, error: "boom" },
  ];
  const s = summarize(rows);
  assert.equal(s.n, 4);
  assert.equal(s.ok, 3);
  assert.equal(s.failed, 1);
  assert.equal(s.jsonFail, 1);
  assert.equal(s.withEdits, 1);
  assert.equal(s.suggestions, 2);
  assert.equal(s.tokens, 60);
  assert.equal(s.avgMs, 200);
  assert.equal(s.p50Ms, 200);
  assert.equal(s.p95Ms, 300);
});

test("summarize: all-failed input yields zeroed latency", () => {
  const s = summarize([{ ok: false, jsonOk: false, suggestions: 0, ms: 5, tokens: 0 }]);
  assert.equal(s.ok, 0);
  assert.equal(s.failed, 1);
  assert.equal(s.avgMs, 0);
  assert.equal(s.p50Ms, 0);
});

test("pool: bounds concurrency and preserves order", async () => {
  let inFlight = 0;
  let max = 0;
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  const res = await pool(items, async (n) => {
    inFlight++;
    max = Math.max(max, inFlight);
    await new Promise((r) => setTimeout(r, 10));
    inFlight--;
    return n * 2;
  }, 3);
  assert.deepEqual(res, [2, 4, 6, 8, 10, 12, 14, 16]);
  assert.ok(max <= 3 && max >= 2, `expected 2..3 in flight, saw ${max}`);
});

test("pool: empty input resolves to [] without spawning work", async () => {
  assert.deepEqual(await pool([], async () => 1, 4), []);
});
