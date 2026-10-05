import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchProfileSelf } from "../SubstackCLI/lib/auth.js";
import { getDraft, listDrafts, listPublished, updateDraft, publishDraft } from "../SubstackCLI/lib/drafts.js";
import { draftToMarkdown } from "../SubstackCLI/lib/convert.js";
import { parseFrontmatter } from "../SubstackCLI/lib/frontmatter.js";
import { proofreadMarkdown, applySuggestions } from "./lib/proofread.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DATA = path.join(ROOT, "data");

// --- minimal .env loader (no deps) ---
function loadEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnv();
const PORT = Number(process.env.PORT || 5179);

function sidFrom(req) {
  const h = req.headers["x-substack-sid"];
  if (h) return String(h);
  if (process.env.SUBSTACK_SID) return process.env.SUBSTACK_SID;
  return "";
}
function pubFrom(req, body, query) {
  const h = req.headers["x-pub"];
  if (h) return String(h);
  if (body?.pub) return String(body.pub);
  if (query?.get("pub")) return String(query.get("pub"));
  // legacy .env fallback (deprecated — UI now picks from /api/me)
  if (process.env.PUB) return process.env.PUB;
  return "";
}

function pubsFromProfile(profile) {
  const arr = profile.publications || profile.publicationUsers || [];
  return arr.map((x) => {
    const pub = x.publication || x;
    const sub = pub.subdomain || pub.handle || "";
    return {
      id: pub.id,
      subdomain: sub,
      host: sub ? `${sub}.substack.com` : "",
      name: pub.name || sub,
    };
  }).filter((p) => p.host);
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

async function readJson(req) {
  let raw = "";
  for await (const c of req) raw += c;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// --- version store ---
function storePath(id) {
  return path.join(DATA, String(id), "store.json");
}
function loadStore(id) {
  const p = storePath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function saveStore(id, store) {
  const dir = path.join(DATA, String(id));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(storePath(id), JSON.stringify(store, null, 2), "utf8");
}
function latestMarkdown(store) {
  return store.versions[store.versions.length - 1].md;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");

    // static
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const f = path.join(ROOT, "public", "index.html");
      const html = fs.readFileSync(f, "utf8");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
      return;
    }

    // whoami + publications derived from SID (no need to save PUB)
    if (req.method === "GET" && url.pathname === "/api/me") {
      const sid = sidFrom(req);
      if (!sid) return send(res, 401, { error: "missing SID" });
      const profile = await fetchProfileSelf(sid);
      return send(res, 200, { id: profile.id, pubs: pubsFromProfile(profile) });
    }

    // list drafts + published
    if (req.method === "GET" && url.pathname === "/api/posts") {
      const sid = sidFrom(req);
      let pub = pubFrom(req, null, url.searchParams);
      if (!sid) return send(res, 401, { error: "missing SID: paste it in UI or set SUBSTACK_SID in .env" });
      if (!pub) {
        // derive: if SID owns exactly 1 publication, use it; else ask to choose
        const profile = await fetchProfileSelf(sid);
        const pubs = pubsFromProfile(profile);
        if (pubs.length === 1) pub = pubs[0].host;
        else return send(res, 409, { error: "multiple publications — pick one", pubs });
      }
      const limit = Number(url.searchParams.get("limit") || 20);
      const [d, p] = await Promise.all([
        listDrafts({ sid, publicationUrl: pub, limit }),
        listPublished({ sid, publicationUrl: pub, limit }),
      ]);
      return send(res, 200, {
        drafts: (d.posts || []).map((x) => ({ id: x.id, title: x.draft_title || x.title, updated: x.draft_updated_at, published: x.is_published })),
        published: (p.posts || []).map((x) => ({ id: x.id, title: x.draft_title || x.title, updated: x.draft_updated_at, published: true })),
      });
    }

    // get one draft -> markdown + versions
    const mGet = url.pathname.match(/^\/api\/posts\/(\d+)$/);
    if (req.method === "GET" && mGet) {
      const sid = sidFrom(req);
      const pub = pubFrom(req, null, url.searchParams);
      if (!sid) return send(res, 401, { error: "missing SID" });
      const id = mGet[1];
      const draft = await getDraft({ sid, publicationUrl: pub, id });
      const md = draftToMarkdown(draft);
      let store = loadStore(id);
      if (!store) {
        store = {
          id: Number(id),
          title: draft.draft_title || draft.title,
          versions: [{ n: 0, md, note: "original from Substack", createdAt: new Date().toISOString() }],
          suggestions: [],
          pushes: [],
          lastSeen: md,
          mode: "none",
        };
        saveStore(id, store);
      } else {
        // Refresh: Substack may have been edited externally (editor, app).
        // lastSeen tracks the Substack content as of our last check.
        store.pushes = store.pushes || [];
        // one-time migration: old code logged each push as a duplicate-content
        // version ("pushed vN …"). Collapse those into push markers instead.
        while (store.versions.length > 1) {
          const last = store.versions[store.versions.length - 1];
          const m = /^pushed v(\d+) to Substack \((republished live|draft only)\)$/.exec(last.note || "");
          const target = m && store.versions.find((x) => x.n === Number(m[1]));
          if (!m || !target || target.md !== last.md) break;
          store.pushes.push({ version: target.n, republished: m[2] === "republished live", at: last.createdAt });
          store.versions.pop();
        }
        if (store.lastSeen === undefined) store.lastSeen = latestMarkdown(store);
        store.title = draft.draft_title || draft.title;
        if (md !== store.lastSeen) {
          if (md === latestMarkdown(store) || store.versions.some((v) => v.md === md)) {
            store.lastSeen = md; // caught up with a known version (e.g. our own push)
            saveStore(id, store);
          } else {
            store.versions.push({
              n: store.versions.length,
              md,
              note: "synced from Substack (edited externally)",
              createdAt: new Date().toISOString(),
            });
            store.suggestions = []; // computed against older text — re-proofread
            store.lastSeen = md;
            saveStore(id, store);
          }
        }
      }
      return send(res, 200, { id, title: draft.draft_title || draft.title, subtitle: draft.draft_subtitle, store });
    }

    // proofread latest version
    const mProof = url.pathname.match(/^\/api\/posts\/(\d+)\/proofread$/);
    if (req.method === "POST" && mProof) {
      const id = mProof[1];
      const store = loadStore(id);
      if (!store) return send(res, 404, { error: "open the post first (GET /api/posts/:id)" });
      const md = latestMarkdown(store);
      const { suggestions, mode } = await proofreadMarkdown(md, {
        apiKey: process.env.GROQ_API_KEY,
        model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      });
      store.suggestions = suggestions;
      store.mode = mode;
      saveStore(id, store);
      return send(res, 200, { suggestions, mode, baseVersion: store.versions.length - 1 });
    }

    // apply accepted suggestions -> new version
    const mApply = url.pathname.match(/^\/api\/posts\/(\d+)\/apply$/);
    if (req.method === "POST" && mApply) {
      const body = await readJson(req);
      const id = mApply[1];
      const store = loadStore(id);
      if (!store) return send(res, 404, { error: "no store" });
      const acceptedIds = new Set(body.acceptedIds || []);
      const accepted = store.suggestions.filter((s) => acceptedIds.has(s.id));
      if (!accepted.length) return send(res, 400, { error: "no suggestions accepted" });
      const md = latestMarkdown(store);
      const next = applySuggestions(md, accepted);
      store.versions.push({
        n: store.versions.length,
        md: next,
        note: `applied ${accepted.length}/${store.suggestions.length} (${store.mode})`,
        createdAt: new Date().toISOString(),
      });
      saveStore(id, store);
      return send(res, 200, { store });
    }

    // push a version to Substack (explicit only)
    const mPush = url.pathname.match(/^\/api\/posts\/(\d+)\/push$/);
    if (req.method === "POST" && mPush) {
      const body = await readJson(req);
      const sid = sidFrom(req);
      const pub = pubFrom(req, body, url.searchParams);
      if (!sid) return send(res, 401, { error: "missing SID" });
      if (!pub) return send(res, 409, { error: "missing pub — pick a publication first" });
      const id = mPush[1];
      const store = loadStore(id);
      if (!store) return send(res, 404, { error: "no store" });
      const v = body.version ?? store.versions.length - 1;
      const target = store.versions.find((x) => x.n === Number(v));
      if (!target) return send(res, 404, { error: "version not found" });
      // draftToMarkdown emits frontmatter (title/subtitle/audience/id) — strip it
      // before mdToTiptap, otherwise it becomes visible ---/text in the post.
      const { data: fm, body: cleanMd } = parseFrontmatter(target.md);
      const result = await updateDraft({
        sid, publicationUrl: pub, id,
        markdown: cleanMd,
        title: fm.title || undefined,
        subtitle: fm.subtitle != null ? String(fm.subtitle) : undefined,
        audience: fm.audience ? String(fm.audience) : undefined,
        baseDir: ".",
      });
      let republished = false;
      // Published posts: updateDraft alone only edits the draft copy — live page
      // stays unchanged until republish. Require explicit opt-in (checkbox in UI).
      if (body.republish) {
        await publishDraft({ sid, publicationUrl: pub, id, send: false, shareAutomatically: false });
        republished = true;
      }
      // Record the push ON the version, not as a new version: versions are
      // content states (v0, v1, …), pushes are events pointing at them.
      store.pushes = store.pushes || [];
      store.pushes.push({ version: target.n, republished, at: new Date().toISOString() });
      store.lastSeen = target.md; // Substack now holds this content
      saveStore(id, store);
      return send(res, 200, { ok: true, pushedVersion: target.n, republished, draft_updated_at: result.draft_updated_at });
    }

    // rewind: duplicate an old version as new head (does NOT push until /push)
    const mRewind = url.pathname.match(/^\/api\/posts\/(\d+)\/rewind$/);
    if (req.method === "POST" && mRewind) {
      const body = await readJson(req);
      const id = mRewind[1];
      const store = loadStore(id);
      if (!store) return send(res, 404, { error: "no store" });
      const target = store.versions.find((x) => x.n === Number(body.version));
      if (!target) return send(res, 404, { error: "version not found" });
      store.versions.push({
        n: store.versions.length,
        md: target.md,
        note: `rewind to v${target.n}`,
        createdAt: new Date().toISOString(),
      });
      saveStore(id, store);
      return send(res, 200, { store });
    }

    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e).slice(0, 800) });
  }
});

server.listen(PORT, () => console.log(`reviewer on http://localhost:${PORT} (PUB=${process.env.PUB || "?"})`));
