import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchProfileSelf } from "../SubstackCLI/lib/auth.js";
import { getDraft, listDrafts, listPublished, updateDraft, publishDraft, translateDraft } from "../SubstackCLI/lib/drafts.js";
import { draftToMarkdown, tiptapToMarkdown } from "../SubstackCLI/lib/convert.js";
import { parseFrontmatter, stringifyFrontmatter } from "../SubstackCLI/lib/frontmatter.js";
import { proofreadMarkdown, applySuggestions, maskOpaque, splitChunks } from "./lib/proofread.js";
import {
  splitParagraphs, paraHash, promptVersion, defaultModel,
  partitionParagraphs, groupNewUnits, proofreadText,
  attributeSuggestions, mergeLedgerSuggestions, reviewedPct,
  filterSuggestions,
} from "./lib/proofread.js";
import { htmlToMarkdown } from "../SubstackKit/lib/convert/html_to_md.js";

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

// Fresh .env read for values the operator may change while the server runs
// (currently the admin password). Falls back to the process env.
function envFresh(key) {
  try {
    for (const raw of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      if (line.slice(0, eq).trim() !== key) continue;
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return v;
    }
  } catch { /* missing .env: fall through */ }
  return process.env[key] || "";
}

function sidFrom(req) {
  const h = req.headers["x-substack-sid"];
  if (h) return String(h);
  if (process.env.SUBSTACK_SID) return process.env.SUBSTACK_SID;
  return "";
}
// Reviewer (service) identity for the contributor model. Falls back to the
// personal SID while a dedicated reviewer account doesn't exist yet.
function reviewerSid() {
  return process.env.REVIEWER_SID || process.env.SUBSTACK_SID || "";
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

async function feedTitle(host) {
  try {
    const r = await fetch(`https://${host}/feed`);
    const xml = await r.text();
    const m = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/.exec(xml) || /<title>([^<]*)<\/title>/.exec(xml);
    return m ? m[1].trim().slice(0, 80) : "";
  } catch {
    return "";
  }
}

// Validate a Substack reference: publication/profile URL or user handle.
// Publication: <host>/api/v1/archive must answer 200 with a list.
// Profile: substack.com/@<handle> must answer 200 (unknown handles redirect).
async function resolveSubstackRef(input) {
  let s = input.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!s) throw new Error("empty");
  // profile URL form: substack.com/@handle[/...]
  let m = /^(?:www\.)?substack\.com\/@([A-Za-z0-9_-]+)/.exec(s);
  if (m) return { kind: "profile", handle: m[1].toLowerCase(), host: "", name: "@" + m[1] };
  if (s.startsWith("@")) {
    const handle = s.slice(1).toLowerCase();
    if (!/^[a-z0-9_-]+$/i.test(handle)) throw new Error("invalid handle");
    // a handle may own a same-name publication — prefer it when it exists
    try {
      return await publicationRef(`${handle}.substack.com`);
    } catch {
      const r = await fetch(`https://substack.com/@${handle}`, { redirect: "manual" });
      if (r.status === 200) return { kind: "profile", handle, host: "", name: "@" + handle };
      throw new Error("profile not found");
    }
  }
  // otherwise a publication host (with or without domain part)
  const host = s.includes(".") ? s : `${s}.substack.com`;
  if (!/^[a-z0-9.-]+$/i.test(host)) throw new Error("invalid Substack link");
  return publicationRef(host);
}

async function publicationRef(host) {
  let r;
  try {
    r = await fetch(`https://${host}/api/v1/archive?sort=new&limit=1&search=&offset=0`);
  } catch {
    throw new Error("publication not found");
  }
  if (!r.ok) throw new Error("publication not found");
  const data = await r.json().catch(() => null);
  if (!Array.isArray(data)) throw new Error("publication not found");
  return { kind: "publication", handle: host.split(".")[0], host, name: (await feedTitle(host)) || host };
}

function send(res, code, obj) {  const body = JSON.stringify(obj);
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
    // Silent review ledger: paraHash -> {suggestions, model, promptHash, at}.
    // Identity is content (never position); survives external syncs.
    reviewed: {},
  };
}

// Migrate flat pre-edition stores ({versions,…}) into {editions:{original:…}}.
function migrateStore(store) {
  let changed = false;
  if (store.editions) {
    for (const ed of Object.values(store.editions)) {
      ed.pushes = ed.pushes || [];
      if (!ed.reviewed || typeof ed.reviewed !== "object") { ed.reviewed = {}; changed = true; }
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

// ---- analysis job queue: FIFO, one at a time, with live ETA ----
// Serializing analyses also protects the Groq per-minute token budget:
// concurrent full-text requests used to 429 each other. In-memory only —
// a restart drops queued jobs (clients re-enqueue on their retry path).
const jobs = new Map();
let jobSeq = 0;
let queueRunning = false;
let secPerChunk = 12; // calibrated by completed jobs (exponential moving average)
function enqueueAnalysis(kind, estChunks, run) {
  const job = {
    id: "j" + (++jobSeq), kind, run, status: "queued", enqueuedAt: Date.now(),
    estChunks: Math.max(1, estChunks), doneChunks: 0,
    result: null, error: null, retryInSec: 0, finishedAt: 0,
  };
  jobs.set(job.id, job);
  for (const [jid, j] of jobs) {
    if ((j.status === "done" || j.status === "error") && Date.now() - j.finishedAt > 10 * 60 * 1000) jobs.delete(jid);
  }
  pumpQueue();
  return job;
}
function queueAhead(job) {
  let aheadChunks = 0;
  let position = 1;
  for (const j of jobs.values()) {
    if (j.id === job.id) break;
    if (j.status === "queued" || j.status === "running") {
      aheadChunks += Math.max(0, j.estChunks - j.doneChunks);
      position++;
    }
  }
  return { aheadChunks, position };
}
function jobEtaSec(job) {
  const { aheadChunks } = queueAhead(job);
  const own = Math.max(0, job.estChunks - job.doneChunks);
  return Math.max(5, Math.round((aheadChunks + own) * secPerChunk));
}
async function pumpQueue() {
  if (queueRunning) return;
  queueRunning = true;
  try {
    for (;;) {
      const next = [...jobs.values()].find((j) => j.status === "queued");
      if (!next) break;
      next.status = "running";
      next.startedAt = Date.now();
      try {
        next.result = await next.run((done) => { next.doneChunks = Math.max(next.doneChunks, done); });
        next.status = "done";
        const elapsed = (Date.now() - next.startedAt) / 1000;
        secPerChunk = secPerChunk * 0.7 + (elapsed / Math.max(1, next.doneChunks || next.estChunks)) * 0.3;
      } catch (e) {
        next.status = "error";
        next.error = String((e && e.message) || e).slice(0, 500);
        next.retryInSec = (e && e.retryInSec) || 0;
      }
      next.finishedAt = Date.now();
    }
  } finally {
    queueRunning = false;
  }
}

const server = http.createServer(async (req, res) => {  try {
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

    // public client config (support contact, reviewer invite email)
    if (req.method === "GET" && url.pathname === "/api/config") {
      return send(res, 200, {
        supportEmail: process.env.SUPPORT_EMAIL || "",
        reviewerEmail: process.env.REVIEWER_EMAIL || "",
      });
    }

    // resolve a Substack profile/publication link or handle (public, no auth)
    if (req.method === "GET" && url.pathname === "/api/resolve") {
      const input = (url.searchParams.get("input") || "").trim();
      if (!input) return send(res, 400, { error: "missing input" });
      try {
        return send(res, 200, await resolveSubstackRef(input));
      } catch (e) {
        return send(res, 404, { error: String(e.message).slice(0, 200) });
      }
    }

    // does the reviewer account have access to this publication?
    if (req.method === "GET" && url.pathname === "/api/access") {
      const pub = url.searchParams.get("pub") || pubFrom(req, null, url.searchParams);
      if (!pub) return send(res, 400, { error: "missing pub" });
      const sid = reviewerSid();
      if (!sid) return send(res, 500, { error: "reviewer SID not configured" });
      // identity used for the check (public handle, not a secret) — guards
      // against silently falling back to the owner's SID and always saying yes
      let checkedAs = "";
      try {
        checkedAs = (await fetchProfileSelf(sid)).handle || "";
      } catch { /* keep empty; access check below still decides */ }
      try {
        await listDrafts({ sid, publicationUrl: pub, limit: 1 });
        return send(res, 200, { hasAccess: true, pub, checkedAs });
      } catch (e) {
        return send(res, 200, { hasAccess: false, pub, checkedAs, reason: String(e.message).slice(0, 160) });
      }
    }

    // ---- read-only admin review (public posts only: no SID, no store writes) ----

    // Password gate: ADMIN_PASSWORD env var. Unset = admin disabled entirely.
    // Re-read from disk per request so .env edits apply without a restart.
    function adminStatus(req) {
      const want = envFresh("ADMIN_PASSWORD");
      if (!want) return "disabled";
      return req.headers["x-admin-key"] === want ? "ok" : "denied";
    }
    if (req.method === "POST" && url.pathname === "/api/admin/auth") {
      const want = envFresh("ADMIN_PASSWORD");
      if (!want) return send(res, 503, { error: "admin disabled" });
      const body = await readJson(req);
      const got = String(body.password || "");
      let ok = got.length === want.length;
      for (let i = 0; i < Math.max(got.length, want.length); i++) ok = ok && got[i] === want[i];
      if (!ok) return send(res, 401, { error: "bad password" });
      return send(res, 200, { ok: true });
    }

    // list recent public posts of any publication (no SID needed)
    if (req.method === "GET" && url.pathname === "/api/admin/archive") {
      const st = adminStatus(req);
      if (st !== "ok") return send(res, st === "disabled" ? 503 : 401, { error: "admin auth required" });
      const input = (url.searchParams.get("pub") || "").trim();
      if (!input) return send(res, 400, { error: "missing pub" });
      let ref;
      try {
        ref = await resolveSubstackRef(input);
      } catch {
        return send(res, 404, { error: "publication not found" });
      }
      if (ref.kind !== "publication" || !ref.host) return send(res, 400, { error: "not a publication" });
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
      const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
      const r = await fetch(`https://${ref.host}/api/v1/archive?sort=new&limit=${limit}&offset=${offset}`);
      const items = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(items)) return send(res, 502, { error: "archive fetch failed" });
      return send(res, 200, {
        host: ref.host,
        name: ref.name,
        // All of these are public: covers, like/comment/restack counts and
        // word counts need no SID. View counts are author-only analytics and
        // stay unavailable here (shown as — in the UI).
        posts: items.filter((p) => p.slug).map((p) => ({
          id: p.id, title: p.title || "(untitled)", slug: p.slug, date: (p.post_date || "").slice(0, 10),
          subtitle: p.subtitle || "", cover: p.cover_image || null,
          likes: p.reaction_count ?? null, comments: p.comment_count ?? null,
          restacks: p.restacks ?? null, words: p.wordcount ?? null,
        })),
      });
    }

    // run the same review engine over a public post. Ephemeral by design:
    // never touches data/<id>/store.json, and the UI offers no apply/push
    // (a non-contributor cannot write to the post). The extracted prose is
    // returned too so the read-only review screen renders with full context.
    if (req.method === "POST" && url.pathname === "/api/admin/analyze") {
      const st = adminStatus(req);
      if (st !== "ok") return send(res, st === "disabled" ? 503 : 401, { error: "admin auth required" });
      const body = await readJson(req);
      const pub = String(body.pub || "").trim();
      const slug = String(body.slug || "").trim();
      if (!pub || !/^[A-Za-z0-9_-]+$/.test(slug)) return send(res, 400, { error: "need pub + slug" });
      let ref;
      try {
        ref = await resolveSubstackRef(pub);
      } catch {
        return send(res, 404, { error: "publication not found" });
      }
      if (ref.kind !== "publication" || !ref.host) return send(res, 400, { error: "not a publication" });
      const r = await fetch(`https://${ref.host}/api/v1/posts/${slug}`);
      const post = await r.json().catch(() => null);
      if (!r.ok || !post || !post.body_html) return send(res, 404, { error: "post not found or paywalled" });
      const title = post.title || slug;
      const subtitle = post.subtitle || "";
      // Public HTML -> Markdown via SubstackKit's tested converter
      // (analysis-only: admin results are never applied or pushed).
      // Same input shape the writer flow sends, captions included.
      const text = htmlToMarkdown(post.body_html).slice(0, 200000);
      if (!text.trim()) return send(res, 400, { error: "empty text" });
      const { masked: admMasked } = maskOpaque(text);
      const job = enqueueAnalysis("admin", splitChunks(admMasked).length, async (progress) => {
        const result = await proofreadMarkdown(text, {
          apiKey: process.env.GROQ_API_KEY,
          model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
          onUsage: (u) => progress(u.chunk),
        });
        return {
          title, subtitle, chars: text.length, text, cover: post.cover_image || null,
          suggestions: result.suggestions, mode: result.mode,
        };
      });
      const { position: admPosition } = queueAhead(job);
      return send(res, 202, { jobId: job.id, position: admPosition, etaSec: jobEtaSec(job) });
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
      const offset = Number(url.searchParams.get("offset") || 0);
      const [d, p] = await Promise.all([
        listDrafts({ sid, publicationUrl: pub, limit, offset }),
        listPublished({ sid, publicationUrl: pub, limit, offset }),
      ]);
      // Reviewed-% comes from the LOCAL cache only (original edition): never
      // fetch bodies just to compute it. Unopened posts report null (—).
      const lpver = promptVersion(null);
      const lpvintage = {
        model: process.env.GROQ_API_KEY ? (process.env.GROQ_MODEL || defaultModel()) : "heuristic",
        promptHash: lpver.hash,
      };
      const item = (x, published) => {
        let reviewedPctVal = null;
        try {
          const st = loadStore(String(x.id));
          const oes = st?.editions?.original;
          if (oes?.reviewed) {
            const { masked: lmasked } = maskOpaque(latestMarkdown(oes));
            reviewedPctVal = reviewedPct(lmasked, oes.reviewed, lpvintage);
          }
        } catch { /* no cache yet — stays null */ }
        return {
          id: x.id,
          title: x.draft_title || x.title,
          updated: x.draft_updated_at,
          date: x.post_date || x.draft_updated_at,
          published: published || !!x.is_published,
          audience: x.audience,
          slug: x.slug || null,
          cover: x.cover_image || null,
          likes: x.reaction_count ?? null,
          comments: (x.comment_count ?? 0) + (x.child_comment_count ?? 0),
          reviewedPct: reviewedPctVal,
          views: x.stats?.views ?? x.stats?.opened ?? null,
          url: x.slug
            ? `https://${pub.replace(/^https?:\/\//, "")}/p/${x.slug}`
            : `https://${pub.replace(/^https?:\/\//, "")}/publish/post/${x.id}`,
          editorUrl: `https://${pub.replace(/^https?:\/\//, "")}/publish/post/${x.id}`,
        };
      };
      return send(res, 200, {
        drafts: (d.posts || []).map((x) => item(x, x.is_published)),
        published: (p.posts || []).map((x) => item(x, true)),
        totals: { drafts: d.total ?? null, published: p.total ?? null },
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
            // Ledger entries are content-addressed, so they stay valid for
            // every unchanged paragraph — never wiped here. The next
            // proofread only sends the new paragraphs to the model.
            es.lastSeen = fresh;
            dirty = true;
          }
        }
        store.title = draft.draft_title || draft.title;
        if (dirty) saveStore(id, store);
      }
      const es = store.editions[edition];
      const cleanPub = String(pub || "").replace(/^https?:\/\//, "");
      return send(res, 200, {
        id,
        edition,
        language: edition === "original" ? draft.language || null : edition,
        title: edition === "original" ? draft.draft_title || draft.title : ed?.title,
        subtitle: draft.draft_subtitle,
        isPublished: !!draft.is_published,
        cover: draft.cover_image || null,
        editorUrl: cleanPub ? `https://${cleanPub}/publish/post/${id}` : null,
        translations,
        store: es,
      });
    }

    // proofread latest version (per edition, in that edition's language).
    // Enqueues a job and returns 202 immediately — the client polls
    // GET /api/jobs/:id for position/ETA/progress. The store is reloaded
    // inside the worker so back-to-back analyses never clobber each other.
    const mProof = url.pathname.match(/^\/api\/posts\/(\d+)\/proofread$/);
    if (req.method === "POST" && mProof) {
      const body = await readJson(req);
      const id = mProof[1];
      const edition = editionParam(url, body);
      const language = body.language || (edition === "original" ? null : edition);
      const store = loadStore(id);
      const es = store?.editions?.[edition];
      if (!es) return send(res, 404, { error: "open the post edition first (GET /api/posts/:id?edition=…)" });
      const md = latestMarkdown(es);
      const { masked } = maskOpaque(md);
      // Ledger vintage: model name + prompt hash. A prompt/model change
      // retires old verdicts — those paragraphs count as new (re-proofread).
      const model = process.env.GROQ_MODEL || defaultModel();
      const ver = promptVersion(language);
      const vintage = { model: process.env.GROQ_API_KEY ? model : "heuristic", promptHash: ver.hash };
      const estNew = partitionParagraphs(masked, es.reviewed, vintage).newUnits.length;
      const job = enqueueAnalysis("proofread", Math.max(estNew, 1), async (progress) => {
        const fresh = loadStore(id);
        const fes = fresh?.editions?.[edition];
        if (!fes) throw new Error("store vanished mid-analysis");
        fes.reviewed = fes.reviewed || {};
        const cur = latestMarkdown(fes);
        const { masked: curMasked, count: maskedCount } = maskOpaque(cur);
        const { units, newUnits } = partitionParagraphs(curMasked, fes.reviewed, vintage);
        const at = new Date().toISOString();
        if (!process.env.GROQ_API_KEY) {
          // Heuristic demo path is local + instant: run whole-text once and
          // attribute its verdicts to the new units like model output.
          const result = await proofreadMarkdown(cur, { language });
          const buckets = {};
          for (const u of newUnits) buckets[u.hash] = [];
          for (const s of result.suggestions) {
            for (const u of newUnits) {
              if (u.para.includes(s.original)) buckets[u.hash].push(s);
            }
          }
          let doneCount = 0;
          for (const u of newUnits) {
            fes.reviewed[u.hash] = {
              suggestions: buckets[u.hash] || [],
              model: vintage.model, promptHash: vintage.promptHash, at, via: "llm",
            };
            progress(++doneCount);
          }
        } else {
          const batches = groupNewUnits(newUnits);
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          for (let b = 0; b < batches.length; b++) {
            if (b > 0) await sleep(3000); // TPM pacing, same as before
            const batchText = batches[b].map((u) => u.para).join("\n\n");
            const found = await proofreadText(batchText, {
              apiKey: process.env.GROQ_API_KEY,
              model, language,
              system: ver.system, template: ver.template,
              onUsage: (u) => progress(u.chunk),
            });
            const byHash = attributeSuggestions(found, batches[b], b);
            for (const u of batches[b]) {
              fes.reviewed[u.hash] = {
                suggestions: byHash[u.hash] || [],
                model: vintage.model, promptHash: vintage.promptHash, at, via: "llm",
              };
            }
          }
          if (batches.length) {
            fes.mode = `ai:${model}${batches.length > 1 ? `×${batches.length}` : ""}${maskedCount ? `-${maskedCount}m` : ""}`;
          }
        }
        fes.suggestions = filterSuggestions(cur, mergeLedgerSuggestions(units, fes.reviewed, vintage)).slice(0, 200);
        saveStore(id, fresh);
        return { suggestions: fes.suggestions, mode: fes.mode, baseVersion: fes.versions.length - 1 };
      });
      const { position } = queueAhead(job);
      return send(res, 202, { jobId: job.id, position, etaSec: jobEtaSec(job) });
    }

    // analysis job status (position in queue, ETA, chunk progress, result)
    const mJob = url.pathname.match(/^\/api\/jobs\/(j\d+)$/);
    if (req.method === "GET" && mJob) {
      const job = jobs.get(mJob[1]);
      if (!job) return send(res, 404, { error: "unknown job" });
      const finished = job.status === "done" || job.status === "error";
      const { position } = finished ? { position: 0 } : queueAhead(job);
      const out = {
        status: job.status, position, etaSec: finished ? 0 : jobEtaSec(job),
        doneChunks: job.doneChunks, estChunks: job.estChunks,
      };
      if (job.status === "done") out.result = job.result;
      if (job.status === "error") {
        out.error = job.error;
        if (job.retryInSec) out.retryInSec = job.retryInSec;
      }
      return send(res, 200, out);
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
      // Record ALL resulting paragraphs as reviewed-empty WITHOUT the model:
      // the user just saw the suggestion list and decided. Accepted fixes are
      // in the text now (their anchors can't re-match); rejected ones must
      // never be re-offered. If the user later edits a paragraph in Substack,
      // its hash flips and it counts as new again — correctly re-offered.
      // Without this, every fix would flip its paragraph hash and force a
      // re-proofread loop.
      es.reviewed = es.reviewed || {};
      const lang = edition === "original" ? null : edition;
      const aver = promptVersion(lang);
      const amodel = process.env.GROQ_API_KEY ? (process.env.GROQ_MODEL || defaultModel()) : "heuristic";
      const { masked: nextMasked } = maskOpaque(next);
      const at = new Date().toISOString();
      const kept = {};
      for (const para of splitParagraphs(nextMasked)) {
        kept[paraHash(para)] = {
          suggestions: [], model: amodel, promptHash: aver.hash, at, via: "apply",
        };
      }
      es.reviewed = kept;
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
          try {
            await publishDraft({ sid, publicationUrl: pub, id, send: false, shareAutomatically: false });
          } catch (e) {
            if (/escolha uma seção|choose a section/i.test(String(e.message))) {
              const cleanPub = String(pub).replace(/^https?:\/\//, "");
              return send(res, 409, {
                error: "A revisão foi salva no rascunho, mas o Substack rejeitou a republicação porque não recebeu a seção do post. O revisor agora preserva a seção existente; se esta tentativa a apagou, abra o editor, selecione a seção novamente e tente atualizar.",
                stage: "republish",
                editorUrl: `https://${cleanPub}/publish/post/${id}`,
              });
            }
            throw e;
          }
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
