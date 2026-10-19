import test from "node:test";
import assert from "node:assert/strict";
import {
  snapOf, sameSnap, snapOfVersion, latestMarkdown, editionParam, editionMarkdown,
  blankEdStore, migrateStore, edStore, pubsFromProfile,
  sidFrom, reviewerSid, pubFrom, readJson, send,
  enqueueAnalysis, queueAhead, jobEtaSec, jobs, pipelineProbe, sanitizeVersions,
} from "../server.js";
import { geminiProvider } from "../lib/llm.js";

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const DOC = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }] };

// ---------------------------------------------------------------------------
// snapshots (transport fields ignored)
// ---------------------------------------------------------------------------

test("snapOf: captures body + human fields, ignores transport fields", () => {
  const s = snapOf("---\ntitle: Hello\nsubtitle: Sub\naudience: everyone\nslug: abc\n---\nBody text");
  assert.equal(s.title, "Hello");
  assert.equal(s.subtitle, "Sub");
  assert.equal(s.audience, "everyone");
  assert.match(s.body, /Body text/);
});

test("sameSnap: slug-only drift is the same content; body change is not", () => {
  const a = snapOf("---\ntitle: T\nslug: one\n---\nBody");
  const b = snapOf("---\ntitle: T\nslug: two\n---\nBody");
  const c = snapOf("---\ntitle: T\nslug: one\n---\nBody changed");
  assert.equal(sameSnap(a, b), true);
  assert.equal(sameSnap(a, c), false);
  assert.equal(sameSnap(a, null), false);
});

test("snapOfVersion: malformed version yields null", () => {
  assert.equal(snapOfVersion({}), null);
  assert.equal(snapOfVersion({ md: "---\ntitle: T\n---\nBody" }).title, "T");
});

test("latestMarkdown: last version wins", () => {
  assert.equal(latestMarkdown({ versions: [{ md: "a" }, { md: "b" }] }), "b");
});

// ---------------------------------------------------------------------------
// edition params + markdown
// ---------------------------------------------------------------------------

test("editionParam: body wins over query, lowercased, defaults original", () => {
  assert.equal(editionParam(new URL("http://x/"), { edition: "EN" }), "en");
  assert.equal(editionParam(new URL("http://x/?edition=Pt-BR"), {}), "pt-br");
  assert.equal(editionParam(new URL("http://x/?edition=en"), { edition: "de" }), "de");
  assert.equal(editionParam(new URL("http://x/"), {}), "original");
});

test("editionMarkdown: original renders the draft body", () => {
  const md = editionMarkdown({ id: 7, draft_title: "T", draft_body: JSON.stringify(DOC) }, "original");
  assert.match(md, /Hello world/);
  assert.match(md, /title: T/);
});

test("editionMarkdown: missing / corrupt translation throws", () => {
  assert.throws(() => editionMarkdown({ post_translations: [] }, "en"), /no en edition/);
  assert.throws(
    () => editionMarkdown({ post_translations: [{ language: "en", draft_body: "not json" }] }, "en"),
    /not valid JSON/,
  );
});

// ---------------------------------------------------------------------------
// store shape + migration
// ---------------------------------------------------------------------------

test("blankEdStore: full edition shape", () => {
  const ed = blankEdStore("---\ntitle: T\n---\nBody");
  assert.equal(ed.versions.length, 1);
  assert.equal(ed.versions[0].n, 0);
  assert.equal(ed.versions[0].md, "---\ntitle: T\n---\nBody");
  assert.deepEqual(ed.suggestions, []);
  assert.deepEqual(ed.pushes, []);
  assert.equal(ed.mode, "none");
  assert.deepEqual(ed.reviewed, {});
  assert.equal(ed.lastSeen.title, "T");
});

test("migrateStore: flat pre-edition store becomes {editions:{original}}", () => {
  const store = { versions: [{ n: 0, md: "x" }], suggestions: [{ id: "s" }], pushes: [], mode: "ai" };
  assert.equal(migrateStore(store), true);
  assert.ok(store.editions.original);
  assert.equal(store.editions.original.mode, "ai");
  assert.equal("versions" in store, false);
  assert.equal("suggestions" in store, false);
  assert.equal("mode" in store, false);
});

test("migrateStore: clean edition reports no change", () => {
  const store = { editions: { original: blankEdStore("---\ntitle: T\n---\nBody") } };
  assert.equal(migrateStore(store), false);
});

test("migrateStore: backfills missing pushes/reviewed and string lastSeen", () => {
  const store = { editions: { original: { versions: [{ n: 0, md: "---\ntitle: T\n---\nBody" }], suggestions: [], mode: "none", lastSeen: "old-string" } } };
  assert.equal(migrateStore(store), true);
  assert.deepEqual(store.editions.original.pushes, []);
  assert.deepEqual(store.editions.original.reviewed, {});
  assert.equal(store.editions.original.lastSeen.title, "T");
});

test("migrateStore: collapses legacy pushed-version into a push marker", () => {
  const md = "---\ntitle: T\n---\nBody";
  const ed = blankEdStore(md);
  ed.versions.push({ n: 1, md, note: "pushed v0 to Substack (draft only)", createdAt: "2024-01-01T00:00:00Z" });
  const store = { editions: { original: ed } };
  assert.equal(migrateStore(store), true);
  assert.equal(ed.versions.length, 1);
  assert.deepEqual(ed.pushes, [{ version: 0, republished: false, at: "2024-01-01T00:00:00Z" }]);
});

test("migrateStore: collapses a duplicate synced version", () => {
  const md = "---\ntitle: T\n---\nBody";
  const ed = blankEdStore(md);
  ed.versions.push({ n: 1, md, note: "synced from Substack now", createdAt: "2024-01-01T00:00:00Z" });
  const store = { editions: { original: ed } };
  assert.equal(migrateStore(store), true);
  assert.equal(ed.versions.length, 1);
});

test("edStore: creates a blank edition on demand, reuses existing", () => {
  const store = { editions: {} };
  const en = edStore(store, "en", "---\ntitle: T\n---\nBody");
  assert.ok(store.editions.en);
  assert.equal(edStore(store, "en", "other"), en);
});

// ---------------------------------------------------------------------------
// request helpers
// ---------------------------------------------------------------------------

test("pubsFromProfile: normalizes publications and publicationUsers", () => {
  const a = pubsFromProfile({ publications: [{ publication: { id: 1, subdomain: "foo", name: "Foo" } }] });
  assert.deepEqual(a, [{ id: 1, subdomain: "foo", host: "foo.substack.com", name: "Foo" }]);
  const b = pubsFromProfile({ publicationUsers: [{ subdomain: "bar", id: 2, name: "Bar" }] });
  assert.equal(b[0].host, "bar.substack.com");
  assert.deepEqual(pubsFromProfile({ publications: [{ publication: { id: 3 } }] }), []);
});

test("sidFrom: header wins, then SUBSTACK_SID, then REVIEWER_SID, else empty", () => {
  assert.equal(sidFrom({ headers: { "x-substack-sid": "abc" } }), "abc");
  withEnv({ SUBSTACK_SID: "envsid" }, () => {
    assert.equal(sidFrom({ headers: {} }), "envsid");
  });
  withEnv({ SUBSTACK_SID: undefined, REVIEWER_SID: "rev" }, () => {
    assert.equal(sidFrom({ headers: {} }), "rev");
  });
  withEnv({ SUBSTACK_SID: undefined, REVIEWER_SID: undefined }, () => {
    assert.equal(sidFrom({ headers: {} }), "");
  });
});

test("reviewerSid: REVIEWER_SID preferred over SUBSTACK_SID", () => {
  withEnv({ REVIEWER_SID: "rev", SUBSTACK_SID: "personal" }, () => {
    assert.equal(reviewerSid(), "rev");
  });
  withEnv({ REVIEWER_SID: undefined, SUBSTACK_SID: "personal" }, () => {
    assert.equal(reviewerSid(), "personal");
  });
});

test("pubFrom: header, body, query precedence; env fallback", () => {
  assert.equal(pubFrom({ headers: { "x-pub": "h.pub" } }, { pub: "b" }, new URLSearchParams("pub=q")), "h.pub");
  assert.equal(pubFrom({ headers: {} }, { pub: "b" }, new URLSearchParams("pub=q")), "b");
  assert.equal(pubFrom({ headers: {} }, {}, new URLSearchParams("pub=q")), "q");
  withEnv({ PUB: "envpub" }, () => {
    assert.equal(pubFrom({ headers: {} }, {}, null), "envpub");
  });
  withEnv({ PUB: undefined }, () => {
    assert.equal(pubFrom({ headers: {} }, {}, null), "");
  });
});

test("readJson: parses body, tolerates empty and malformed", async () => {
  async function* body(...chunks) { for (const c of chunks) yield Buffer.from(c); }
  assert.deepEqual(await readJson(body('{"a":1}')), { a: 1 });
  assert.deepEqual(await readJson(body()), {});
  assert.deepEqual(await readJson(body("{oops")), {});
});

test("send: JSON headers, content-length, body", () => {
  let cap = null;
  const res = { writeHead: (code, headers) => { cap = { code, headers }; }, end: (b) => { cap.body = b; } };
  send(res, 201, { ok: true });
  assert.equal(cap.code, 201);
  assert.equal(cap.headers["Content-Type"], "application/json");
  assert.equal(cap.headers["Cache-Control"], "no-store");
  assert.equal(cap.headers["Content-Length"], Buffer.byteLength(cap.body));
  assert.deepEqual(JSON.parse(cap.body), { ok: true });
});

// ---------------------------------------------------------------------------
// FIFO analysis queue
// ---------------------------------------------------------------------------

test("queue: running job is counted ahead; ETA uses chunk estimate", () => {
  const before = [...jobs.values()].filter((j) => j.status === "queued" || j.status === "running").length;
  const j1 = enqueueAnalysis("t", 4, () => new Promise(() => {}));
  assert.match(j1.id, /^j\d+$/);
  assert.equal(j1.status, "running"); // pumpQueue promotes synchronously
  const j2 = enqueueAnalysis("t", 3, () => new Promise(() => {}));
  assert.equal(j2.status, "queued");
  const q = queueAhead(j2);
  assert.equal(q.position, before + 2);
  assert.equal(q.aheadChunks, 4);
  assert.ok(jobEtaSec(j2) >= 5);
});

test("queue: live pace of the running job lowers the ETA", () => {
  const job = {
    id: "jlivepace", kind: "t", status: "running", enqueuedAt: Date.now(),
    startedAt: Date.now() - 40000, estChunks: 20, doneChunks: 2,
    result: null, error: null, retryInSec: 0, finishedAt: 0,
  };
  jobs.set(job.id, job);
  const slow = jobEtaSec(job); // ~20s per chunk so far
  job.startedAt = Date.now() - 2000; // now ~1s per chunk
  const fast = jobEtaSec(job);
  jobs.delete(job.id);
  assert.ok(fast < slow, `live fast pace (${fast}) should be below slow (${slow})`);
});

// ---------------------------------------------------------------------------
// hosted pipeline self-test (POST /api/health/proofread -> pipelineProbe)
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const rec = { url, opts, body: opts?.body ? JSON.parse(opts.body) : null };
    calls.push(rec);
    return handler(rec);
  };
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

function resp({ ok = true, status = 200, body = "" } = {}) {
  return { ok, status, headers: { get: () => null }, async text() { return body; } };
}

test("pipelineProbe: no providers is reported, not thrown", async () => {
  const r = await pipelineProbe({ providers: [] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no LLM provider/);
});

test("pipelineProbe: --only a missing provider names it", async () => {
  const r = await pipelineProbe({ providers: [geminiProvider({ key: "k" })], only: "opencode" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /"opencode" not configured/);
  assert.deepEqual(r.providers, ["gemini"]);
});

test("pipelineProbe: happy path serves via the real prompt and filters suggestions", async () => {
  const { calls, restore } = mockFetch(() => resp({
    body: JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ suggestions: [{ original: "errro", replacement: "erro", reason: "ortografia" }] }) } }],
      usage: { total_tokens: 9 },
    }),
  }));
  try {
    const r = await pipelineProbe({ providers: [geminiProvider({ key: "k" })], sample: "Encontrei um errro no texto." });
    assert.equal(r.ok, true);
    assert.equal(r.provider, "gemini");
    assert.equal(r.model, geminiProvider({ key: "k" }).model);
    assert.equal(r.suggestionCount, 1);
    assert.deepEqual(r.suggestions[0], { original: "errro", replacement: "erro", reason: "ortografia" });
    assert.ok(r.promptHash);
    // Wired through the real prompt: system + a single text user message.
    assert.equal(calls.length, 1);
    assert.ok(calls[0].body.messages[0].content.length > 50);
    assert.equal(calls[0].body.messages[1].role, "user");
    assert.match(calls[0].body.messages[1].content, /errro/);
  } finally { restore(); }
});

test("sanitizeVersions: maps S3 snapshots and strips author emails", () => {
  const raw = {
    contentId: "post/1/cur/9/hash",
    publishedContentKey: null,
    versions: {
      previousBucket: null,
      contents: [
        { Key: "post/1/cur/9/hash", LastModified: "2026-10-05T19:11:34.000Z", Size: 2737, url: "s3://x", user: { id: 9, name: "Daniel", email: "a@b.c" } },
        { Key: "post/1/old/9/hash", LastModified: "2025-10-24T18:40:49.000Z", Size: 47, url: "s3://y", user: null },
      ],
    },
  };
  const v = sanitizeVersions(raw);
  assert.equal(v.current, "post/1/cur/9/hash");
  assert.equal(v.items.length, 2);
  assert.deepEqual(v.items[0].user, { id: 9, name: "Daniel" });
  assert.equal(v.items[1].user, null);
  assert.ok(!("email" in (v.items[0].user || {})), "email must never be forwarded");
  assert.ok(!JSON.stringify(v).includes("a@b.c"));
  assert.equal(v.items[0].at, "2026-10-05T19:11:34.000Z");
});

test("sanitizeVersions: tolerates a missing/garbage payload", () => {
  assert.deepEqual(sanitizeVersions(null), { current: null, previousBucket: null, published: null, items: [] });
  assert.deepEqual(sanitizeVersions({}).items, []);
});
