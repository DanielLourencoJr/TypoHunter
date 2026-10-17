import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const appSrc = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .find((script) => script.includes("function renderMarkdown"));
assert.ok(appSrc, "inline app script not found");

function classList() {
  const values = new Set();
  return {
    add: (...items) => items.forEach((item) => values.add(item)),
    remove: (...items) => items.forEach((item) => values.delete(item)),
    contains: (item) => values.has(item),
    toggle: (item, force) => {
      const enabled = force === undefined ? !values.has(item) : Boolean(force);
      enabled ? values.add(item) : values.delete(item);
      return enabled;
    },
  };
}

function element(id) {
  return {
    id, value: "", textContent: "", innerHTML: "", disabled: false,
    style: {}, dataset: {}, attributes: {}, classList: classList(),
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, click() {},
    scrollIntoView() {}, appendChild() {}, remove() {},
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name] ?? null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
  };
}

test("login gate allows the verification tab and keeps access results generic", async () => {
  const elements = new Map();
  const calls = [];
  let verificationSucceeds = false;
  const genericMessage = "If the reviewer account has access, a temporary draft contains your verification code. Check your publication’s drafts, then enter the code here.";
  const sandbox = {
    console,
    URL,
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, element(id));
        return elements.get(id);
      },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      documentElement: { classList: classList(), dataset: {} },
      body: { classList: classList() },
    },
    window: { addEventListener() {}, scrollTo() {} },
    location: { hash: "", href: "http://localhost/" },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async (input, init = {}) => {
      const url = new URL(input, "http://localhost/");
      calls.push({ path: url.pathname, search: url.searchParams, init });
      if (url.pathname === "/api/config") return { ok: true, status: 200, json: async () => ({ reviewerEmail: "reviewer@example.test" }) };
      if (url.pathname === "/api/auth/session") return { ok: false, status: 401, json: async () => ({}) };
      if (url.pathname === "/api/resolve") return { ok: true, status: 200, json: async () => ({ kind: "publication", host: "writer.substack.com", name: "Writer" }) };
      if (url.pathname === "/api/auth/challenge") return { ok: true, status: 202, json: async () => ({ ok: true, message: genericMessage }) };
      if (url.pathname === "/api/auth/verify") {
        if (!verificationSucceeds) return { ok: false, status: 401, json: async () => ({ error: "invalid or expired code" }) };
        return { ok: true, status: 200, json: async () => ({ ok: true, pub: "writer.substack.com", expiresAt: Date.now() + 60_000 }) };
      }
      if (url.pathname === "/api/posts") return { ok: true, status: 200, json: async () => ({ totals: { drafts: 2, published: 4 } }) };
      throw new Error(`unexpected request: ${url.pathname}`);
    },
    atob: globalThis.atob,
    btoa: globalThis.btoa,
    TextDecoder,
    Uint8Array,
    setTimeout,
    clearTimeout,
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(appSrc, context, { filename: "public/index.html#auth-ui" });

  const get = (id) => elements.get(id);
  assert.equal(get("auth-tab-code").getAttribute("aria-selected"), "false");
  get("auth-tab-code").onclick();
  assert.equal(get("auth-panel-code").style.display, "");
  assert.equal(get("auth-tab-code").getAttribute("aria-selected"), "true");
  for (let attempt = 0; attempt < 20 && get("auth-reviewer-email")?.textContent !== "reviewer@example.test"; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(get("auth-reviewer-email").textContent, "reviewer@example.test");

  get("auth-tab-setup").onclick();
  get("auth-ref").value = "writer.substack.com";
  await get("auth-next").onclick();
  assert.ok(calls.some((call) => call.path === "/api/auth/challenge"), "setup submits a challenge request");
  const challengeCall = calls.find((call) => call.path === "/api/auth/challenge");
  assert.deepEqual(JSON.parse(challengeCall.init.body), { pub: "writer.substack.com" });
  assert.equal(get("auth-panel-code").style.display, "");
  assert.match(get("auth-setup-status").textContent, /rascunho temporário/);

  get("auth-code").value = "wrong-code";
  await get("auth-verify").onclick();
  assert.equal(get("err-auth-code").textContent, "Código inválido ou expirado. Confira o título do rascunho e tente novamente.");

  verificationSucceeds = true;
  get("auth-code").value = "VALIDCODE1234";
  await get("auth-verify").onclick();
  assert.equal(vm.runInContext("S.auth.pub", context), "writer.substack.com");
  assert.equal(get("welcome").classList.contains("on"), false, "successful login closes the gate");
  assert.equal(get("main").style.display, "", "successful login reveals the app");
  assert.equal(get("v-dash").classList.contains("on"), true, "successful login opens the dashboard view");
  assert.match(get("dash-info").innerHTML, /Acesso confirmado/);
});
