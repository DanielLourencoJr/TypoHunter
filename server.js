import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchProfileSelf } from "../SubstackCLI/lib/auth.js";
import { getDraft, listDrafts, listPublished, updateDraft, publishDraft, translateDraft } from "../SubstackCLI/lib/drafts.js";
import { draftToMarkdown, tiptapToMarkdown } from "../SubstackCLI/lib/convert.js";
import { parseFrontmatter, stringifyFrontmatter } from "../SubstackCLI/lib/frontmatter.js";
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
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body) });
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

// Substack-content snapshot for sync comparison. Frontmatter carries transport
// fields (slug, id, publication_id) that change without any real edit —
// publishing assigns a slug — so compare body + human fields only.
function snapOf(md) {
  const { data: fm, body } = parseFrontmatter(md);
  return {
    body,
    title: fm.title || "",
    subtitle: fm.subtitle != null ? String(fm.subtitle) : "",
    audience: fm.audience || "",
  };
}
function sameSnap(a, b) {
  return !!a && !!b && a.body === b.body && a.title === b.title &&
    a.subtitle === b.subtitle && a.audience === b.audience;
}
function snapOfVersion(v) {
  try {
    return snapOf(v.md);
  } catch {
    return null;
  }
}

function editionParam(url, body) {
  const e = body?.edition || url.searchParams.get("edition") || "original";
  return String(e).toLowerCase();
}

// Markdown for one edition: original draft_body, or a post_translations entry.
function editionMarkdown(draft, edition) {
  if (!edition || edition === "original") return draftToMarkdown(draft);
  const t = (draft.post_translations || []).find((x) => String(x.language).toLowerCase() === edition);
  if (!t) throw new Error(`no ${edition} edition on this post`);
  let doc;
  try {
    doc = typeof t.draft_body === "string" ? JSON.parse(t.draft_body) : t.draft_body;
  } catch {
    throw new Error(`${edition} edition body is not valid JSON`);
  }
  const meta = {
    title: t.draft_title || "",
    subtitle: t.draft_subtitle || "",
    id: draft.id,
    edition: "translation",
    language: t.language,
    audience: draft.audience || "everyone",
    publication_id: draft.publication_id,
  };
  for (const k of Object.keys(meta)) if (meta[k] == null || meta[k] === "") delete meta[k];
  return stringifyFrontmatter(meta) + tiptapToMarkdown(doc);
}

function blankEdStore(md) {
  const now = new Date().toISOString();
  return {
    versions: [{ n: 0, md, note: "original from Substack", createdAt: now }],
    suggestions: [],
    pushes: [],
    lastSeen: snapOf(md),
    mode: "none",
  };
}

// Migrate flat pre-edition stores ({versions,…}) into {editions:{original:…}}.
function migrateStore(store) {
  let changed = false;
  if (store.editions) {
    for (const ed of Object.values(store.editions)) {
      ed.pushes = ed.pushes || [];
      // collapse legacy duplicate-content push versions inside each edition
      while (ed.versions.length > 1) {
        const last = ed.versions[ed.versions.length - 1];
        const m = /^pushed v(\d+) to Substack \((republished live|draft only)\)$/.exec(last.note || "");
        const target = m && ed.versions.find((x) => x.n === Number(m[1]));
        if (!m || !target || target.md !== last.md) break;
        ed.pushes.push({ version: target.n, republished: m[2] === "republished live", at: last.createdAt });
        ed.versions.pop();
        changed = true;
      }
      // collapse spurious "synced from Substack" versions that duplicate an
      // earlier version's content (e.g. frontmatter-only drift like a new slug)
      while (ed.versions.length > 1) {
        const last = ed.versions[ed.versions.length - 1];
        if (!/^synced from Substack/.test(last.note || "")) break;
        const dup = ed.versions.some((v) => v !== last && sameSnap(snapOfVersion(v), snapOfVersion(last)));
        if (!dup) break;
        ed.versions.pop();
        changed = true;
      }
      // string-era lastSeen (full markdown) → snapshot object
      if (typeof ed.lastSeen === "string" || !ed.lastSeen || typeof ed.lastSeen.body !== "string") {
        ed.lastSeen = snapOf(latestMarkdown(ed));
        changed = true;
      }
    }
    return changed;
  }
  const { versions, suggestions, pushes, lastSeen, mode } = store;
  store.editions = {
    original: { versions, suggestions: suggestions || [], pushes: pushes || [], lastSeen, mode: mode || "none" },
  };
  delete store.versions;
  delete store.suggestions;
  delete store.pushes;
  delete store.lastSeen;
  delete store.mode;
  return true;
}

function edStore(store, edition, md) {
  if (!store.editions[edition]) store.editions[edition] = blankEdStore(md);
  return store.editions[edition];
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");

    // static (never cached: the UI evolves fast during testing)
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const f = path.join(ROOT, "public", "index.html");
      const html = fs.readFileSync(f, "utf8");
      res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
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

    // get one draft -> markdown + versions (per edition)
    const mGet = url.pathname.match(/^\/api\/posts\/(\d+)$/);
    if (req.method === "GET" && mGet) {
      const sid = sidFrom(req);
      const pub = pubFrom(req, null, url.searchParams);
      if (!sid) return send(res, 401, { error: "missing SID" });
      const id = mGet[1];
      const edition = editionParam(url);
      const draft = await getDraft({ sid, publicationUrl: pub, id });
      const translations = (draft.post_translations || []).map((t) => ({ language: String(t.language).toLowerCase(), title: t.draft_title }));
      if (edition !== "original" && !translations.some((t) => t.language === edition)) {
        return send(res, 404, { error: `no ${edition} edition on this post` });
      }
      const md = editionMarkdown(draft, edition);
      const ed = translations.find((t) => t.language === edition);
      let store = loadStore(id);
      if (!store) {
        store = { id: Number(id), title: draft.draft_title || draft.title, editions: {} };
        store.editions[edition] = blankEdStore(md);
        saveStore(id, store);
      } else {
        let dirty = migrateStore(store);
        const isNewEdition = !store.editions[edition];
        const es = edStore(store, edition, md);
        if (isNewEdition) dirty = true;
        // Refresh: Substack may have been edited externally (editor, app).
        // Compare content snapshots, not raw markdown: transport fields like
        // slug change without any real edit (e.g. on publish).
        const fresh = snapOf(md);
        if (!sameSnap(fresh, es.lastSeen)) {
          if (es.versions.some((v) => sameSnap(snapOfVersion(v), fresh))) {
            es.lastSeen = fresh; // caught up with a known version (e.g. our own push)
            dirty = true;
          } else {
            es.versions.push({
              n: es.versions.length,
              md,
              note: "synced from Substack (edited externally)",
              createdAt: new Date().toISOString(),
            });
            es.suggestions = []; // computed against older text — re-proofread
            es.lastSeen = fresh;
            dirty = true;
          }
        }
        store.title = draft.draft_title || draft.title;
        if (dirty) saveStore(id, store);
      }
      const es = store.editions[edition];
      return send(res, 200, {
        id,
        edition,
        language: edition === "original" ? draft.language || null : edition,
        title: edition === "original" ? draft.draft_title || draft.title : ed?.title,
        subtitle: draft.draft_subtitle,
        isPublished: !!draft.is_published,
        translations,
        store: es,
      });
    }

    // proofread latest version (per edition, in that edition's language)
    const mProof = url.pathname.match(/^\/api\/posts\/(\d+)\/proofread$/);
    if (req.method === "POST" && mProof) {
      const body = await readJson(req);
      const id = mProof[1];
      const edition = editionParam(url, body);
      const store = loadStore(id);
      const es = store?.editions?.[edition];
      if (!es) return send(res, 404, { error: "open the post edition first (GET /api/posts/:id?edition=…)" });
      const md = latestMarkdown(es);
      let result;
      try {
        result = await proofreadMarkdown(md, {
          apiKey: process.env.GROQ_API_KEY,
          model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
          language: body.language || (edition === "original" ? null : edition),
        });
      } catch (e) {
        // surface Groq rate limits as 429 (with retry hint) instead of generic 500
        if (/Groq HTTP 429/.test(e.message)) {
          const m = /try again in ([\d.]+)s/i.exec(e.message);
          return send(res, 429, {
            error: String(e.message).slice(0, 500),
            retryInSec: m ? Math.max(1, Math.ceil(Number(m[1]))) : 10,
          });
        }
        throw e;
      }
      const { suggestions, mode } = result;
      es.suggestions = suggestions;
      es.mode = mode;
      saveStore(id, store);
      return send(res, 200, { suggestions, mode, baseVersion: es.versions.length - 1 });
    }

    // apply accepted suggestions -> new version
    const mApply = url.pathname.match(/^\/api\/posts\/(\d+)\/apply$/);
    if (req.method === "POST" && mApply) {
      const body = await readJson(req);
      const id = mApply[1];
      const edition = editionParam(url, body);
      const store = loadStore(id);
      const es = store?.editions?.[edition];
      if (!es) return send(res, 404, { error: "no store" });
      const acceptedIds = new Set(body.acceptedIds || []);
      const accepted = es.suggestions.filter((s) => acceptedIds.has(s.id));
      if (!accepted.length) return send(res, 400, { error: "no suggestions accepted" });
      const md = latestMarkdown(es);
      const { md: next, applied, skipped } = applySuggestions(md, accepted);
      es.versions.push({
        n: es.versions.length,
        md: next,
        note: `applied ${applied}/${es.suggestions.length} (${es.mode})${skipped ? `, ${skipped} skipped (not in text)` : ""}`,
        createdAt: new Date().toISOString(),
      });
      es.suggestions = []; // consumed into the new version — re-proofread for more
      saveStore(id, store);
      return send(res, 200, { store: es });
    }

    // push a version to Substack (explicit only).
    // Original -> updateDraft (translations untouched). Translation edition ->
    // translateDraft (Substack only allows this on unpublished drafts).
    const mPush = url.pathname.match(/^\/api\/posts\/(\d+)\/push$/);
    if (req.method === "POST" && mPush) {
      const body = await readJson(req);
      const sid = sidFrom(req);
      const pub = pubFrom(req, body, url.searchParams);
      if (!sid) return send(res, 401, { error: "missing SID" });
      if (!pub) return send(res, 409, { error: "missing pub — pick a publication first" });
      const id = mPush[1];
      const edition = editionParam(url, body);
      const store = loadStore(id);
      const es = store?.editions?.[edition];
      if (!es) return send(res, 404, { error: "no store" });
      const v = body.version ?? es.versions.length - 1;
      const target = es.versions.find((x) => x.n === Number(v));
      if (!target) return send(res, 404, { error: "version not found" });
      // frontmatter is transport only — strip it before mdToTiptap, otherwise
      // it becomes visible ---/text in the post.
      const { data: fm, body: cleanMd } = parseFrontmatter(target.md);
      let draft_updated_at = null;
      let republished = false;
      if (!edition || edition === "original") {
        // NOTE: PUT carries no `translations` field, so other language editions
        // are left untouched (verified live: EN edition survived updateDraft).
        const result = await updateDraft({
          sid, publicationUrl: pub, id,
          markdown: cleanMd,
          title: fm.title || undefined,
          subtitle: fm.subtitle != null ? String(fm.subtitle) : undefined,
          audience: fm.audience ? String(fm.audience) : undefined,
          baseDir: ".",
        });
        draft_updated_at = result.draft_updated_at;
        // Published posts: updateDraft alone only edits the draft copy — live page
        // stays unchanged until republish. Require explicit opt-in (checkbox in UI).
        if (body.republish) {
          await publishDraft({ sid, publicationUrl: pub, id, send: false, shareAutomatically: false });
          republished = true;
        }
      } else {
        try {
          await translateDraft({
            sid, publicationUrl: pub, id, language: edition,
            markdown: cleanMd,
            title: fm.title || undefined,
            subtitle: fm.subtitle != null ? String(fm.subtitle) : undefined,
            baseDir: ".",
          });
        } catch (e) {
          return send(res, 400, { error: `translation push failed: ${String(e.message).slice(0, 300)}` });
        }
      }
      // Record the push ON the version, not as a new version: versions are
      // content states (v0, v1, …), pushes are events pointing at them.
      es.pushes = es.pushes || [];
      es.pushes.push({ version: target.n, republished, at: new Date().toISOString() });
      es.lastSeen = snapOf(target.md); // Substack now holds this content
      saveStore(id, store);
      return send(res, 200, { ok: true, pushedVersion: target.n, republished, draft_updated_at });
    }

    // rewind: duplicate an old version as new head (does NOT push until /push)
    const mRewind = url.pathname.match(/^\/api\/posts\/(\d+)\/rewind$/);
    if (req.method === "POST" && mRewind) {
      const body = await readJson(req);
      const id = mRewind[1];
      const edition = editionParam(url, body);
      const store = loadStore(id);
      const es = store?.editions?.[edition];
      if (!es) return send(res, 404, { error: "no store" });
      const target = es.versions.find((x) => x.n === Number(body.version));
      if (!target) return send(res, 404, { error: "version not found" });
      es.versions.push({
        n: es.versions.length,
        md: target.md,
        note: `rewind to v${target.n}`,
        createdAt: new Date().toISOString(),
      });
      saveStore(id, store);
      return send(res, 200, { store: es });
    }

    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e).slice(0, 800) });
  }
});

server.listen(PORT, () => console.log(`reviewer on http://localhost:${PORT} (PUB=${process.env.PUB || "?"})`));
