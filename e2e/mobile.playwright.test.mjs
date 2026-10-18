import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { server } from "../server.js";

// Guards the reported regression: the sliding auth cards must fit a phone
// viewport entirely — no manual scrolling inside a card, no horizontal
// overflow. Runs against the in-process server (or BASE_URL when hosted); all
// /api/** calls are mocked, so no Substack account or key is used.
const HOSTED = String(process.env.BASE_URL || "").replace(/\/+$/, "");
const PHONE = { width: 390, height: 844 };

test(`auth slides fit a phone viewport without scrolling${HOSTED ? ` (${HOSTED})` : ""}`, { timeout: 30_000 }, async (t) => {
  let baseUrl = HOSTED;
  let startedServer = false;
  if (!HOSTED) {
    server.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    startedServer = true;
  }
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    if (startedServer && server.listening) await new Promise((resolve) => server.close(resolve));
  });

  const page = await browser.newPage({ viewport: PHONE });
  await page.route("**/*", (route) => new URL(route.request().url()).origin === baseUrl
    ? route.continue()
    : route.abort());
  const publications = [
    { host: "writer.substack.com", name: "The Writer", image: "" },
    { host: "second.substack.com", name: "Second Thoughts", image: "" },
    { host: "third.substack.com", name: "A Third One With A Long Name", image: "" },
  ];
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config") return route.fulfill({ json: { reviewerEmail: "substack.proofreader@proton.me" } });
    if (url.pathname === "/api/auth/session") return route.fulfill({ status: 401, json: {} });
    if (url.pathname === "/api/resolve") return route.fulfill({ json: { kind: "profile", handle: "writer", name: "Writer", host: "", publications } });
    if (url.pathname === "/api/auth/challenge") return route.fulfill({ status: 202, json: { ok: true } });
    return route.fulfill({ status: 404, json: {} });
  });

  const fits = async (name) => {
    const m = await page.evaluate(() => {
      const active = document.querySelector('.auth-screen[aria-hidden="false"]');
      const dialog = active?.querySelector(".auth-dialog");
      return dialog ? {
        vOverflow: dialog.scrollHeight - dialog.clientHeight,
        hOverflow: document.documentElement.scrollWidth - window.innerWidth,
      } : null;
    });
    assert.ok(m, `${name}: an active auth card exists`);
    assert.ok(m.vOverflow <= 1, `${name}: card fits without vertical scrolling (overflow ${m.vOverflow}px)`);
    assert.ok(m.hOverflow <= 0, `${name}: no horizontal overflow (${m.hOverflow}px)`);
  };

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#auth-screen-welcome")?.getBoundingClientRect().top === 0);
  await fits("welcome");

  await page.getByRole("button", { name: "Começar" }).click();
  await page.waitForFunction(() => document.querySelector("#auth-screen-setup")?.getAttribute("aria-hidden") === "false");
  await fits("setup");

  await page.locator("#auth-ref").fill("https://substack.com/@writer");
  await page.getByRole("button", { name: "Solicitar código" }).click();
  await page.waitForFunction(() => document.querySelector("#auth-screen-pub")?.getAttribute("aria-hidden") === "false");
  assert.equal(await page.locator("#auth-screen-pub select").count(), 0, "publication chooser uses cards, not a <select>");
  assert.equal(await page.locator("#auth-profile-list .publication-card").count(), publications.length, "one card per publication");
  await fits("publication");

  await page.getByRole("button", { name: "Ir para o código" }).click();
  await page.waitForFunction(() => document.querySelector("#auth-screen-code")?.getAttribute("aria-hidden") === "false");
  await fits("code");
});
