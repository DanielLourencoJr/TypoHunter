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

test("login gate presents setup and verification as sequential steps", async () => {
  const elements = new Map();
  const calls = [];
  let verificationSucceeds = false;
  let resolvedInput = "writer.substack.com";
  let currentLanding = "drafts";
  let currentPub = "writer.substack.com";
  const genericMessage = "If the reviewer account has access, a temporary draft contains your verification code. Check your publication’s drafts, then enter the code here.";
  const sandbox = {
    console,
    URL,
    URLSearchParams,
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, element(id));
        return elements.get(id);
      },
      querySelector() { return null; },
      querySelectorAll(selector) {
        if (selector !== ".view") return [];
        return ["profile", "tutorial", "dash", "library", "history", "review", "done", "admingate"].map((name) => {
          const id = `v-${name}`;
          if (!elements.has(id)) elements.set(id, element(id));
          return elements.get(id);
        });
      },
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
      if (url.pathname === "/api/config") return { ok: true, status: 200, json: async () => ({ reviewerEmail: "" }) };
      if (url.pathname === "/api/auth/session") return { ok: false, status: 401, json: async () => ({}) };
      if (url.pathname === "/api/resolve") {
        if (resolvedInput.includes("@writer")) return { ok: true, status: 200, json: async () => ({ kind: "profile", handle: "writer", name: "Writer Profile", host: "", publications: [{ host: "writer.substack.com", name: "Writer", image: "https://cdn.example.test/writer.png" }, { host: "second.substack.com", name: "Second", image: "https://cdn.example.test/second.png" }] }) };
        return { ok: true, status: 200, json: async () => ({ kind: "publication", host: "writer.substack.com", name: "Writer" }) };
      }
      if (url.pathname === "/api/auth/challenge") {
        const challenge = JSON.parse(init.body);
        currentLanding = challenge.landing;
        currentPub = challenge.pub;
        return { ok: true, status: 202, json: async () => ({ ok: true, message: genericMessage }) };
      }
      if (url.pathname === "/api/auth/verify") {
        if (!verificationSucceeds) return { ok: false, status: 401, json: async () => ({ error: "invalid or expired code" }) };
        return { ok: true, status: 200, json: async () => ({ ok: true, pub: currentPub, landing: currentLanding, expiresAt: Date.now() + 60_000 }) };
      }
      if (url.pathname === "/api/profile/totals") return { ok: true, status: 200, json: async () => ({ drafts: { "writer.substack.com": 2 }, published: 47 }) };
      if (url.pathname === "/api/posts") return { ok: true, status: 200, json: async () => ({ drafts: [], published: [], totals: { drafts: 2, published: 4 } }) };
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

  const get = (id) => {
    if (!elements.has(id)) elements.set(id, element(id));
    return elements.get(id);
  };
  assert.equal(get("welcome-intro").style.display, "", "the public service presentation is the first screen");
  assert.equal(get("welcome-auth").style.display, "none", "login steps stay behind the introduction");
  assert.match(html, /id="welcome-intro"[\s\S]*?sem copiar e colar/);
  get("welcome-start").onclick();
  assert.equal(get("welcome-intro").style.display, "none");
  assert.equal(get("welcome-auth").style.display, "");
  assert.notEqual(get("auth-panel-setup").style.display, "none", "contributor setup is the first step");
  assert.notEqual(get("auth-panel-code").style.display, "none", "verification follows setup on the same page");
  assert.equal(get("welcome-auth").classList.contains("show-code"), false, "setup card is active first");
  assert.equal(get("auth-screen-setup").getAttribute("aria-hidden"), "false");
  assert.equal(get("auth-screen-code").getAttribute("aria-hidden"), "true");
  assert.equal(get("auth-screen-setup").inert, false);
  assert.equal(get("auth-screen-code").inert, true, "hidden card controls cannot receive keyboard focus");
  assert.ok(html.indexOf('id="auth-panel-setup"') < html.indexOf('id="auth-panel-code"'), "setup appears before verification");
  assert.ok(html.indexOf('id="auth-screen-setup"') < html.indexOf('id="auth-screen-code"'), "setup screen precedes code screen");
  assert.doesNotMatch(html, /auth-tab|role="tablist"/, "the login flow has no tabs");
  assert.match(html, /\.auth-flow\{[^}]*overflow:hidden/s, "the stage clips page scrolling");
  assert.match(html, /\.auth-screen\{[^}]*height:100%/s, "each screen fills the viewport stage");
  assert.match(html, /\.auth-dialog\{[^}]*height:100%/s, "each card fills its screen vertically");
  assert.match(html, /#auth-screen-code\{transform:translateY\(100%\)/, "the code card starts one full screen below setup");
  assert.match(html, /#welcome-auth\.show-code #auth-screen-setup\{transform:translateY\(-100%\)/, "the transition moves the entire setup card away");
  assert.match(html, /#welcome-auth\.show-code #auth-screen-code\{transform:translateY\(0\)/, "the transition brings the code card into place");
  assert.match(html, /body\.bare\{overflow:hidden\}/, "the document cannot scroll behind the cards");
  for (let attempt = 0; attempt < 20 && get("auth-reviewer-email")?.textContent !== "substack.proofreader@proton.me"; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(get("auth-reviewer-email").textContent, "substack.proofreader@proton.me");

  get("auth-ref").value = "writer.substack.com";
  await get("auth-next").onclick();
  assert.ok(calls.some((call) => call.path === "/api/auth/challenge"), "setup submits a challenge request");
  const challengeCall = calls.find((call) => call.path === "/api/auth/challenge");
  assert.deepEqual(JSON.parse(challengeCall.init.body), { pub: "writer.substack.com", landing: "drafts" });
  assert.equal(get("welcome-auth").classList.contains("show-code"), true, "a successful challenge advances to the code card");
  assert.equal(get("auth-screen-setup").getAttribute("aria-hidden"), "true");
  assert.equal(get("auth-screen-code").getAttribute("aria-hidden"), "false");
  assert.equal(get("auth-screen-setup").inert, true);
  assert.equal(get("auth-screen-code").inert, false);
  assert.match(get("auth-setup-status").textContent, /rascunho temporário/);
  get("auth-prev-step").onclick();
  assert.equal(get("welcome-auth").classList.contains("show-code"), false, "the back control restores the setup card");
  vm.runInContext("focusVerificationStep()", context);

  get("auth-code").value = "wrong-code";
  await get("auth-verify").onclick();
  assert.equal(get("err-auth-code").textContent, "Código inválido ou expirado. Confira o título do rascunho e tente novamente.");

  verificationSucceeds = true;
  get("auth-code").value = "VALIDCODE1234";
  await get("auth-verify").onclick();
  assert.equal(vm.runInContext("S.auth.pub", context), "writer.substack.com");
  assert.equal(get("welcome").classList.contains("on"), false, "successful login closes the gate");
  assert.equal(get("main").style.display, "", "successful login reveals the app");
  assert.equal(get("v-library").classList.contains("on"), true, "direct publication login opens the drafts menu");
  assert.equal(get("v-dash").classList.contains("on"), false, "direct publication login skips the dashboard");

  vm.runInContext("S.auth = null; S.ref = null; S.profileRef = null; S.pendingPub = ''; showLoginGate()", context);
  assert.equal(get("welcome-auth").style.display, "none", "a fresh login returns to the service introduction");
  get("welcome-start").onclick();
  resolvedInput = "https://substack.com/@writer";
  get("auth-ref").value = resolvedInput;
  const challengesBeforeProfile = calls.filter((call) => call.path === "/api/auth/challenge").length;
  await get("auth-next").onclick();
  assert.equal(get("auth-profile-picker").style.display, "", "profile input reveals its publication selector");
  assert.equal(calls.filter((call) => call.path === "/api/auth/challenge").length, challengesBeforeProfile, "profile selection happens before creating a code draft");
  get("auth-profile-pub").value = "writer.substack.com";
  await get("auth-next").onclick();
  assert.deepEqual(JSON.parse(calls.filter((call) => call.path === "/api/auth/challenge").at(-1).init.body), { pub: "writer.substack.com", landing: "dashboard" });

  await get("auth-verify").onclick();
  assert.equal(get("v-dash").classList.contains("on"), true, "profile login opens the publication selection dashboard");
  assert.equal(get("dash-profile-picker").style.display, "");
  assert.match(get("dash-publications").innerHTML, /second\.substack\.com/);
  assert.match(get("dash-publications").innerHTML, /cdn\.example\.test\/writer\.png/);
  assert.match(get("dash-publications").innerHTML, /Verificado/);
  assert.match(get("dash-publications").innerHTML, /A verificar/);
  assert.match(get("dash-publications").innerHTML, /writer\.substack\.com[\s\S]*?Verificado/);
  assert.match(get("dash-publications").innerHTML, /second\.substack\.com[\s\S]*?A verificar/);
  assert.equal(get("dash-go").style.display, "none", "profile selection uses publication cards instead of a shared button");
  assert.match(get("dash-info").innerHTML, /Publicados: 47/, "main dashboard card shows profile-wide published totals");
  assert.match(get("dash-publications").innerHTML, /Rascunhos: 2/, "verified publication card shows its own draft count");
  assert.match(get("dash-publications").innerHTML, /Rascunhos: Desconhecido/, "unverified publication card hides its draft count");
  assert.match(get("dash-info").innerHTML, /rascunhos considera apenas publicações verificadas/);
  assert.doesNotMatch(get("dash-info").innerHTML, /<a\b|Acesso confirmado/, "the profile summary has no single-publication link or global access claim");
  const totalsCall = calls.filter((call) => call.path === "/api/profile/totals").at(-1);
  assert.deepEqual(totalsCall.search.getAll("host"), ["writer.substack.com", "second.substack.com"]);
  await vm.runInContext("openProfilePublication('second.substack.com')", context);
  assert.equal(get("welcome").classList.contains("on"), true, "another publication requires verification before opening");
  assert.equal(get("welcome-auth").style.display, "", "switching publication opens authentication directly");
  await get("auth-next").onclick();
  assert.deepEqual(JSON.parse(calls.filter((call) => call.path === "/api/auth/challenge").at(-1).init.body), { pub: "second.substack.com", landing: "dashboard" });
  await get("auth-verify").onclick();
  assert.equal(vm.runInContext("S.auth.pub", context), "second.substack.com");
  assert.equal(get("v-dash").classList.contains("on"), true, "second verified publication returns to the card dashboard");
  assert.match(get("dash-publications").innerHTML, /second\.substack\.com[\s\S]*?Verificado/);
  assert.match(get("dash-publications").innerHTML, /writer\.substack\.com[\s\S]*?A verificar/);
  await vm.runInContext("openProfilePublication('second.substack.com')", context);
  assert.equal(get("v-library").classList.contains("on"), true, "selected verified publication opens its drafts menu");
});
