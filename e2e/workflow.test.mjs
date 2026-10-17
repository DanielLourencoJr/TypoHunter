import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { randomInt } from "node:crypto";
import { server, storePath, runAuthCleanup } from "../server.js";

const realFetch = globalThis.fetch;
const envNames = ["SUBSTACK_SID", "REVIEWER_SID", "REVIEWER_EMAIL", "GROQ_API_KEY", "GEMINI_API_KEY", "LLM_ORDER", "AUTH_STATE_PATH", "AUTH_CHALLENGE_TTL_MS"];
const originalEnv = Object.fromEntries(envNames.map((key) => [key, process.env[key]]));
let draftId;
let baseUrl;
let remoteDraft;
let putPayload;
let challengeDraft;
let reviewerCanAccess = false;
let challengeDeleted = false;
let challengeStateFile;
let sessionCookie = "";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textOf(node) {
  if (!node || typeof node !== "object") return "";
  return [node.text || "", ...(node.content || []).map(textOf)].join(" ");
}

function makeClassList() {
  const values = new Set();
  return {
    add: (...items) => items.forEach((item) => values.add(item)),
    remove: (...items) => items.forEach((item) => values.delete(item)),
    contains: (item) => values.has(item),
    toggle: (item, force) => {
      const add = force === undefined ? !values.has(item) : !!force;
      if (add) values.add(item);
      else values.delete(item);
      return add;
    },
  };
}

function makeElement(id) {
  return {
    id, value: "", textContent: "", innerHTML: "", disabled: false, href: "", src: "",
    style: {}, dataset: {}, classList: makeClassList(),
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, click() {},
    scrollIntoView() {}, appendChild() {}, remove() {}, setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
  };
}

async function waitFor(fn, label, timeoutMs = 3000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${label}`);
}

test("main workflow: fetch, review, accept/reject, apply, and push", async (t) => {
  do {
    draftId = String(900000000 + randomInt(1, 90000000));
  } while (fs.existsSync(path.dirname(storePath(draftId))));
  assert.equal(fs.existsSync(storePath(draftId)), false, "generated test draft id must not already have a store");

  process.env.SUBSTACK_SID = "e2e-fake-session";
  delete process.env.REVIEWER_SID;
  process.env.REVIEWER_EMAIL = "reviewer@example.test";
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
  process.env.LLM_ORDER = "groq"; // no key: use deterministic local heuristic, never a model
  process.env.AUTH_CHALLENGE_TTL_MS = "1000";
  challengeStateFile = path.join(os.tmpdir(), `typohunter-auth-e2e-${process.pid}-${Date.now()}.json`);
  process.env.AUTH_STATE_PATH = challengeStateFile;

  remoteDraft = {
    id: Number(draftId),
    draft_title: "E2E workflow draft",
    draft_subtitle: "Test subtitle",
    draft_section_id: 42,
    audience: "everyone",
    is_published: false,
    language: "en",
    post_translations: [],
    draft_body: JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "This draft has teh first typo." }] },
        { type: "paragraph", content: [{ type: "text", text: "We will recieve feedback." }] },
      ],
    }),
  };
  putPayload = null;
  challengeDraft = null;
  challengeDeleted = false;
  reviewerCanAccess = false;

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname !== "e2e-example.substack.com" && url.hostname !== "substack.com") {
      throw new Error(`unexpected external request in E2E: ${url.hostname}`);
    }
    if (url.pathname === "/api/v1/user/e2e-writer/public_profile") {
      assert.equal(new Headers(init.headers).get("cookie"), null, "public profile lookup does not send the reviewer SID");
      return response({
        id: 88, handle: "e2e-writer", name: "E2E Writer",
        publications: [
          { name: "First publication", subdomain: "e2e-example" },
          { name: "Second publication", subdomain: "e2e-second" },
        ],
        subscriptions: [{ name: "Unrelated subscription", subdomain: "unrelated" }],
      });
    }
    assert.equal(new Headers(init.headers).get("cookie"), "substack.sid=e2e-fake-session");
    if (url.pathname === "/api/v1/user/profile/self") {
      return response({ id: 77, handle: "typo-reviewer", publications: [] });
    }
    if (url.pathname === "/api/v1/post_management/drafts") {
      if (!reviewerCanAccess) return response({ error: "not a contributor" }, 403);
      const posts = [{ id: Number(draftId), draft_title: remoteDraft.draft_title, audience: "everyone" }];
      if (challengeDraft) posts.unshift({ id: challengeDraft.id, draft_title: challengeDraft.draft_title, audience: "everyone" });
      return response({ posts, total: posts.length });
    }
    if (url.pathname === "/api/v1/post_management/published") return response({ posts: [], total: 0 });
    if (url.pathname === `/api/v1/drafts/${draftId}` && (!init.method || init.method === "GET")) {
      return response(remoteDraft);
    }
    if (url.pathname === `/api/v1/drafts/${draftId}` && init.method === "PUT") {
      putPayload = JSON.parse(init.body);
      remoteDraft = { ...remoteDraft, ...putPayload };
      return response(remoteDraft);
    }
    if (url.pathname === "/api/v1/drafts" && init.method === "POST") {
      assert.equal(reviewerCanAccess, true, "challenge draft creation must require reviewer contributor access");
      const payload = JSON.parse(init.body);
      challengeDraft = { id: Number(draftId) + 1, draft_title: payload.draft_title, draft_body: payload.draft_body };
      return response(challengeDraft);
    }
    if (challengeDraft && url.pathname === `/api/v1/drafts/${challengeDraft.id}` && init.method === "DELETE") {
      challengeDeleted = true;
      challengeDraft = null;
      return response({ ok: true });
    }
    throw new Error(`unexpected Substack request: ${init.method || "GET"} ${url.pathname}`);
  };

  t.after(async () => {
    globalThis.fetch = realFetch;
    for (const key of envNames) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(path.dirname(storePath(draftId)), { recursive: true, force: true });
    if (challengeStateFile) fs.rmSync(challengeStateFile, { force: true });
  });

  server.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const anonymousPosts = await realFetch(`${baseUrl}/api/posts`);
  assert.equal(anonymousPosts.status, 401, "draft APIs must be gated before login");
  const anonymousConfig = await realFetch(`${baseUrl}/api/config`);
  assert.equal((await anonymousConfig.json()).reviewerEmail, "reviewer@example.test", "reviewer email remains available before login");
  const profileResponse = await realFetch(`${baseUrl}/api/resolve?input=${encodeURIComponent("@e2e-writer")}`);
  const profile = await profileResponse.json();
  assert.equal(profile.kind, "profile");
  assert.deepEqual(profile.publications.map((pub) => pub.host), ["e2e-example.substack.com", "e2e-second.substack.com"]);
  assert.equal(profile.publications.some((pub) => pub.host === "unrelated.substack.com"), false, "the profile selector excludes publications the writer only subscribes to");
  const challengeRequest = (cookie = "") => realFetch(`${baseUrl}/api/auth/challenge`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ pub: "e2e-example.substack.com", landing: "drafts" }),
  });
  const noAccessResponse = await challengeRequest();
  assert.equal(noAccessResponse.status, 202);
  const noAccessBody = await noAccessResponse.json();
  assert.equal(challengeDraft, null, "no challenge draft is created without contributor access");
  const preauthCookie = noAccessResponse.headers.get("set-cookie").split(";")[0];
  const invalidBeforeAccess = await realFetch(`${baseUrl}/api/auth/verify`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: preauthCookie }, body: JSON.stringify({ code: "never-valid" }),
  });
  assert.equal(invalidBeforeAccess.status, 401);
  const invalidBody = await invalidBeforeAccess.json();

  reviewerCanAccess = true;
  const withAccessResponse = await challengeRequest(preauthCookie);
  assert.equal(withAccessResponse.status, 202);
  assert.deepEqual(await withAccessResponse.json(), noAccessBody, "challenge response does not reveal whether access is granted");
  assert.ok(challengeDraft, "contributor access creates a temporary code draft");
  const challengeCode = challengeDraft.draft_title.match(/([A-F0-9]{12})$/)?.[1];
  assert.ok(challengeCode, "verification code appears in the draft title");

  const invalidCode = await realFetch(`${baseUrl}/api/auth/verify`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: preauthCookie }, body: JSON.stringify({ code: "wrong-code" }),
  });
  assert.equal(invalidCode.status, 401);
  assert.deepEqual(await invalidCode.json(), invalidBody, "invalid-code response is the same without and with contributor access");
  const verified = await realFetch(`${baseUrl}/api/auth/verify`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: preauthCookie }, body: JSON.stringify({ code: challengeCode.toLowerCase() }),
  });
  assert.equal(verified.status, 200);
  const verifiedBody = await verified.json();
  assert.equal(verifiedBody.pub, "e2e-example.substack.com");
  assert.equal(verifiedBody.landing, "drafts", "direct publication verification keeps the drafts landing choice");
  sessionCookie = verified.headers.get("set-cookie").split(", ").find((value) => value.startsWith("th_session=")).split(";")[0];
  assert.ok(challengeDeleted, "verification draft is deleted immediately after successful login");
  const activeSession = await (await realFetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: sessionCookie } })).json();
  assert.equal(activeSession.pub, "e2e-example.substack.com");
  assert.equal(activeSession.landing, "drafts", "landing choice survives page reload");

  challengeDeleted = false;
  const expiringResponse = await challengeRequest();
  assert.equal(expiringResponse.status, 202);
  assert.ok(challengeDraft, "a later sign-in creates another temporary draft");
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await runAuthCleanup();
  assert.equal(challengeDeleted, true, "expired verification drafts are deleted by cleanup");
  assert.equal(challengeDraft, null);

  const page = await realFetch(baseUrl);
  assert.equal(page.status, 200);
  const html = await page.text();
  const appScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .find((script) => script.includes("function renderMarkdown"));
  assert.ok(appScript, "served page must contain the real app script");

  const elements = new Map();
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const sandbox = {
    console,
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, makeElement(id));
        return elements.get(id);
      },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      documentElement: { classList: makeClassList(), dataset: {} },
      body: { classList: makeClassList() },
    },
    window: { addEventListener() {}, scrollTo() {} },
    localStorage: storage,
    sessionStorage: storage,
    location: { hash: "", href: baseUrl + "/" },
    fetch: (input, init = {}) => {
      const headers = new Headers(init.headers);
      if (sessionCookie) headers.set("Cookie", sessionCookie);
      return realFetch(new URL(input, baseUrl), { ...init, headers });
    },
    atob: globalThis.atob,
    btoa: globalThis.btoa,
    TextDecoder,
    Uint8Array,
    setTimeout: (fn, _ms, ...args) => setTimeout(fn, 0, ...args),
    clearTimeout,
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(appScript, context, { filename: "served-public-index.html#script" });

  await waitFor(() => vm.runInContext("S.auth?.pub === 'e2e-example.substack.com'", context), "authenticated app boot");
  await vm.runInContext("S.pub = 'e2e-example.substack.com'; loadLibrary()", context);
  assert.match(elements.get("drafts").innerHTML, /E2E workflow draft/);

  await vm.runInContext(`openHistory('${draftId}')`, context);
  await waitFor(() => vm.runInContext("S.cur?.sugState === 'ready'", context), "proofread suggestions");
  assert.equal(vm.runInContext("S.cur.sugs.length", context), 2);

  vm.runInContext("renderReview(false); showView('review')", context);
  assert.match(elements.get("rv-doc").innerHTML, /data-toggle-change="h1"/);
  assert.match(elements.get("rv-doc").innerHTML, /data-toggle-change="h2"/);

  vm.runInContext("decide('h1', 'y'); decide('h2', 'n'); renderReview(false)", context);
  await vm.runInContext("finishReview('final')", context);
  assert.match(elements.get("done-summary").textContent, /1 aceitas aplicadas/);
  await elements.get("done-push").onclick();

  assert.ok(putPayload, "the final push should update the remote draft");
  assert.equal(putPayload.draft_title, "E2E workflow draft");
  assert.equal(putPayload.draft_section_id, 42);
  assert.equal("translations" in putPayload, false);
  const pushedText = textOf(JSON.parse(remoteDraft.draft_body));
  assert.match(pushedText, /the first typo/);
  assert.match(pushedText, /recieve feedback/);
  assert.doesNotMatch(pushedText, /teh first typo/);

  const { store } = await (await realFetch(`${baseUrl}/api/posts/${draftId}?edition=original`, {
    headers: { Cookie: sessionCookie, "x-pub": "attacker-example.substack.com" },
  })).json();
  assert.equal(store.versions.length, 2, "push marks the applied version; it does not create another version");
  assert.equal(store.pushes.length, 1);
  assert.equal(store.pushes[0].version, 1);

  const loggedOut = await realFetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { Cookie: sessionCookie } });
  assert.equal(loggedOut.status, 200);
  assert.equal((await realFetch(`${baseUrl}/api/posts`, { headers: { Cookie: sessionCookie } })).status, 401, "logout revokes the session");
});
