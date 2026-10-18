import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { server } from "../server.js";

const realFetch = globalThis.fetch;

test("hosted health surface + reviewer edit-check", async (t) => {
  let createdId = null;
  let deleted = false;

  process.env.SUBSTACK_SID = "e2e-health-sid";
  delete process.env.REVIEWER_SID;
  process.env.SMOKE_PUB = "health-example.substack.com";
  process.env.LLM_ORDER = "groq"; // no key -> no providers, deterministic
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
  process.env.RENDER_GIT_COMMIT = "testcommit";
  const authFile = path.join(os.tmpdir(), `typohunter-health-${process.pid}-${Date.now()}.json`);
  process.env.AUTH_STATE_PATH = authFile;

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url.hostname === "substack.com" && url.pathname === "/api/v1/user/profile/self") {
      return json({ id: 1, handle: "typo-reviewer", publications: [{ subdomain: "health-example" }] });
    }
    if (url.hostname === "health-example.substack.com" && url.pathname === "/api/v1/post_management/drafts") {
      return json({ posts: [], total: 0 });
    }
    if (url.hostname === "health-example.substack.com" && url.pathname === "/api/v1/drafts" && init.method === "POST") {
      createdId = 555001;
      return json({ id: createdId, draft_title: "TypoHunter capacity check" });
    }
    if (url.hostname === "health-example.substack.com" && url.pathname === `/api/v1/drafts/${createdId}` && init.method === "DELETE") {
      deleted = true;
      return json({ ok: true });
    }
    throw new Error(`unexpected request: ${init.method || "GET"} ${url}`);
  };

  t.after(async () => {
    globalThis.fetch = realFetch;
    delete process.env.SMOKE_PUB;
    delete process.env.RENDER_GIT_COMMIT;
    fs.rmSync(authFile, { force: true });
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  });

  server.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const health = await realFetch(`${base}/api/health`);
  assert.equal(health.status, 200, "health is public");
  const hb = await health.json();
  assert.equal(hb.ok, true);
  assert.equal(hb.commit, "testcommit");
  assert.equal(hb.deep, true, "deep check reports configured when SMOKE_PUB is set");
  assert.ok(Array.isArray(hb.providers));

  const noKey = await realFetch(`${base}/api/health/deep`, { method: "POST" });
  assert.equal(noKey.status, 404, "deep check is hidden without the reviewer key");
  assert.equal(deleted, false);

  const badKey = await realFetch(`${base}/api/health/deep`, { method: "POST", headers: { "x-health-key": "wrong" } });
  assert.equal(badKey.status, 404);

  const ok = await realFetch(`${base}/api/health/deep`, { method: "POST", headers: { "x-health-key": "e2e-health-sid" } });
  assert.equal(ok.status, 200);
  const okBody = await ok.json();
  assert.equal(okBody.canEdit, true);
  assert.equal(okBody.pub, "health-example.substack.com");
  assert.equal(createdId, 555001, "a throwaway draft is created");
  assert.equal(deleted, true, "the throwaway draft is deleted immediately");
});
