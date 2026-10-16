import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { randomInt } from "node:crypto";
import { server, storePath } from "../server.js";

const realFetch = globalThis.fetch;
const envNames = ["SUBSTACK_SID", "REVIEWER_SID", "GROQ_API_KEY", "GEMINI_API_KEY", "LLM_ORDER"];
const originalEnv = Object.fromEntries(envNames.map((key) => [key, process.env[key]]));
let draftId;
let baseUrl;
let remoteDraft;
let putPayload;

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
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
  process.env.LLM_ORDER = "groq"; // no key: use deterministic local heuristic, never a model

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

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname !== "e2e-example.substack.com") {
      throw new Error(`unexpected external request in E2E: ${url.hostname}`);
    }
    assert.equal(new Headers(init.headers).get("cookie"), "substack.sid=e2e-fake-session");
    if (url.pathname === "/api/v1/post_management/drafts") {
      return response({ posts: [{ id: Number(draftId), draft_title: remoteDraft.draft_title, audience: "everyone" }], total: 1 });
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
  });

  server.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

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
    location: { hash: "" },
    localStorage: storage,
    sessionStorage: storage,
    fetch: (input, init) => realFetch(new URL(input, baseUrl), init),
    atob: globalThis.atob,
    btoa: globalThis.btoa,
    TextDecoder,
    Uint8Array,
    setTimeout: (fn, _ms, ...args) => setTimeout(fn, 0, ...args),
    clearTimeout,
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(appScript, context, { filename: "served-public-index.html#script" });

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
    headers: { "x-pub": "e2e-example.substack.com" },
  })).json();
  assert.equal(store.versions.length, 2, "push marks the applied version; it does not create another version");
  assert.equal(store.pushes.length, 1);
  assert.equal(store.pushes[0].version, 1);
});
