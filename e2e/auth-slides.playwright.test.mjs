import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { server } from "../server.js";

// Runs against the in-process server by default, or against a deployed URL when
// BASE_URL is set (the same spec, so hosted UI behavior is checked like local).
// All /api/** calls are mocked below, so a hosted run needs no real Substack.
const HOSTED = String(process.env.BASE_URL || "").replace(/\/+$/, "");

test(`browser shows welcome, contributor setup, then verification code${HOSTED ? ` (${HOSTED})` : ""}`, { timeout: 30_000 }, async (t) => {
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

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route("**/*", (route) => new URL(route.request().url()).origin === baseUrl
    ? route.continue()
    : route.abort());
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/config") {
      return route.fulfill({ json: { reviewerEmail: "substack.proofreader@proton.me" } });
    }
    if (url.pathname === "/api/auth/session") {
      return route.fulfill({ status: 401, json: { error: "unauthorized" } });
    }
    if (url.pathname === "/api/resolve") {
      return route.fulfill({ json: { kind: "publication", host: "writer.substack.com", name: "Writer" } });
    }
    if (url.pathname === "/api/auth/challenge") {
      return route.fulfill({ status: 202, json: { ok: true, message: "Challenge started" } });
    }
    return route.fulfill({ status: 404, json: { error: "unexpected API request" } });
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const screenTop = async (id) => page.locator(`#${id}`).evaluate((screen) => screen.getBoundingClientRect().top);
  const viewportHeight = page.viewportSize().height;
  await page.waitForFunction(() => document.querySelector("#auth-screen-welcome")?.getBoundingClientRect().top === 0);
  assert.equal(await page.locator("#auth-screen-welcome").getAttribute("aria-hidden"), "false");

  await page.getByRole("button", { name: "Começar" }).click();
  await page.waitForFunction(() => {
    const setup = document.querySelector("#auth-screen-setup");
    const stage = document.querySelector("#welcome-auth");
    return setup?.getAttribute("aria-hidden") === "false" && stage?.scrollTop === 0 && Math.abs(setup.getBoundingClientRect().top) < 1;
  }, null, { timeout: 2000 });
  assert.ok(Math.abs(await screenTop("auth-screen-setup")) < 1, "contributor setup occupies the viewport after Começar");
  assert.ok(Math.abs((await screenTop("auth-screen-welcome")) + viewportHeight) < 1, "welcome moves exactly one viewport above setup");
  assert.ok(Math.abs((await screenTop("auth-screen-code")) - 2 * viewportHeight) < 1, "verification stays exactly two viewports below setup (publication chooser between them)");
  assert.equal(await page.locator("#auth-screen-code").getAttribute("aria-hidden"), "true");

  await page.locator("#auth-ref").fill("writer.substack.com");
  await page.getByRole("button", { name: "Solicitar código" }).click();
  await page.waitForFunction(() => {
    const code = document.querySelector("#auth-screen-code");
    const stage = document.querySelector("#welcome-auth");
    return code?.getAttribute("aria-hidden") === "false" && stage?.scrollTop === 0 && Math.abs(code.getBoundingClientRect().top) < 1;
  });
  assert.ok(Math.abs(await screenTop("auth-screen-code")) < 1, "verification occupies the viewport only after requesting the code");
  assert.ok(Math.abs((await screenTop("auth-screen-setup")) + 2 * viewportHeight) < 1, "setup moves two viewports above verification");

  await page.getByRole("button", { name: "Voltar à configuração" }).click();
  await page.waitForFunction(() => {
    const setup = document.querySelector("#auth-screen-setup");
    const stage = document.querySelector("#welcome-auth");
    return setup?.getAttribute("aria-hidden") === "false" && stage?.scrollTop === 0 && Math.abs(setup.getBoundingClientRect().top) < 1;
  });
  assert.ok(Math.abs(await screenTop("auth-screen-setup")) < 1, "back navigation returns to contributor setup");
});
