import test from "node:test";
import assert from "node:assert/strict";
import { server, probeReviewerSid, resetSidHealth } from "../server.js";

const realFetch = globalThis.fetch;

test("readiness probe is read-only, alerts once on expiry, and recovers", async (t) => {
  let rejected = false;
  let created = 0;
  const alerts = [];

  process.env.REVIEWER_SID = "e2e-ready-sid";
  delete process.env.SUBSTACK_SID;
  process.env.SMOKE_PUB = "ready-example.substack.com";
  process.env.SID_ALERT_WEBHOOK = "https://alerts.example/hook";
  process.env.RENDER_GIT_COMMIT = "readycommit";

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url.hostname === "alerts.example") {
      alerts.push(JSON.parse(init.body || "{}"));
      return json({ ok: true });
    }
    if (url.hostname === "substack.com" && url.pathname === "/api/v1/user/profile/self") {
      return rejected ? json({ error: "Not authorized" }, 403) : json({ id: 1, handle: "reviewer" });
    }
    if (url.hostname === "ready-example.substack.com" && url.pathname === "/api/v1/post_management/drafts") {
      return rejected ? json({ error: "Not authorized" }, 403) : json({ posts: [], total: 0 });
    }
    if (url.hostname === "ready-example.substack.com" && init.method === "POST") {
      created += 1;
      return json({ id: 1 });
    }
    throw new Error(`unexpected request: ${init.method || "GET"} ${url}`);
  };

  t.after(async () => {
    globalThis.fetch = realFetch;
    delete process.env.SMOKE_PUB;
    delete process.env.SID_ALERT_WEBHOOK;
    delete process.env.RENDER_GIT_COMMIT;
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  });

  resetSidHealth();
  server.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const ok = await realFetch(`${base}/api/health/ready`);
  assert.equal(ok.status, 200, "healthy reviewer reports ready");
  const okBody = await ok.json();
  assert.equal(okBody.ok, true);
  assert.equal(okBody.commit, "readycommit");
  assert.equal(created, 0, "readiness never creates a draft");
  assert.equal(alerts.length, 0);

  rejected = true;
  resetSidHealth();
  const expired = await realFetch(`${base}/api/health/ready`);
  assert.equal(expired.status, 503, "expired reviewer reports not ready");
  const expiredBody = await expired.json();
  assert.equal(expiredBody.ok, false);
  assert.equal(expiredBody.reason, "draft access unavailable", "public reason stays generic");
  assert.equal(alerts.length, 1, "expiry sends exactly one webhook");
  assert.match(alerts[0].text, /expired/);
  assert.equal(created, 0);

  const again = await realFetch(`${base}/api/health/ready`);
  assert.equal(again.status, 503);
  assert.equal(alerts.length, 1, "repeated probes do not spam the webhook");

  rejected = false;
  await probeReviewerSid({ force: true });
  const recovered = await realFetch(`${base}/api/health/ready`);
  assert.equal(recovered.status, 200);
  assert.equal(alerts.length, 2, "recovery sends one webhook");
  assert.match(alerts[1].text, /restored/);
  assert.equal(created, 0);

  delete process.env.REVIEWER_SID;
  resetSidHealth();
  const missing = await realFetch(`${base}/api/health/ready`);
  assert.equal(missing.status, 503, "missing reviewer SID is not ready");
  assert.equal(alerts.length, 3, "missing SID on a fresh state also alerts");
});
