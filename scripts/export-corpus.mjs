#!/usr/bin/env node
// One-shot corpus exporter: dumps every draft + published post (original and
// translation editions) as markdown into testdata/corpus/ and freezes it.
//
// READ-ONLY by design: only list/get calls, never writes to Substack.
// The output is a FROZEN benchmark fixture ("one ordinary Substack year") —
// do NOT re-run to overwrite it. The author deliberately leaves these texts
// unfixed so TypoHunter always has real-world test material.
//
// Usage:
//   node scripts/export-corpus.mjs [--pub <host>] [--out testdata/corpus]
//   PUB / SUBSTACK_SID / REVIEWER_SID come from .env (same as server.js).

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadEnvFile, fetchProfileSelf } from "../../SubstackCLI/lib/auth.js";
import { getDraft, listDrafts, listPublished } from "../../SubstackCLI/lib/drafts.js";
import { draftToMarkdown, tiptapToMarkdown } from "../../SubstackCLI/lib/convert.js";
import { stringifyFrontmatter } from "../../SubstackCLI/lib/frontmatter.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
loadEnvFile(path.join(ROOT, ".env"));

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const safe = (s) => String(s || "untitled").toLowerCase().normalize("NFKD")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "untitled";

// Minimal translation rendering (mirrors server.js editionMarkdown).
function translationMarkdown(draft, language) {
  const t = (draft.post_translations || []).find((x) => String(x.language).toLowerCase() === language);
  if (!t) throw new Error(`no ${language} edition`);
  let doc;
  try {
    doc = typeof t.draft_body === "string" ? JSON.parse(t.draft_body) : t.draft_body;
  } catch {
    throw new Error(`${language} edition body is not valid JSON`);
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

async function main() {
  const sid = process.env.REVIEWER_SID || process.env.SUBSTACK_SID || "";
  if (!sid) throw new Error("SUBSTACK_SID missing (see .env.example)");
  let pub = opt("--pub", process.env.PUB || "");
  if (!pub) {
    const profile = await fetchProfileSelf(sid);
    const arr = profile.publications || profile.publicationUsers || [];
    const pubs = arr.map((x) => {
      const p = x.publication || x;
      const sub = p.subdomain || p.handle || "";
      return sub ? `${sub}.substack.com` : "";
    }).filter(Boolean);
    const uniq = [...new Set(pubs)];
    if (uniq.length !== 1) {
      throw new Error(`multiple publications, pass --pub explicitly (choices: ${uniq.join(", ")})`);
    }
    pub = uniq[0];
  }

  const out = path.resolve(ROOT, opt("--out", "testdata/corpus"));
  const postsDir = path.join(out, "posts");
  if (fs.existsSync(out) && fs.readdirSync(out).length > 0) {
    throw new Error(`refusing to overwrite non-empty ${out} — corpus is FROZEN (delete by hand if you really mean it)`);
  }
  fs.mkdirSync(postsDir, { recursive: true });

  // Paginate drafts + published.
  const seen = new Map();
  for (const fn of [listDrafts, listPublished]) {
    let offset = 0;
    for (;;) {
      const res = await fn({ sid, publicationUrl: pub, limit: 50, offset });
      for (const p of res.posts || []) if (!seen.has(p.id)) seen.set(p.id, p);
      if (!res.posts || res.posts.length < 50) break;
      offset += 50;
      await sleep(400);
    }
  }
  console.log(`listed ${seen.size} posts from ${pub}`);

  const manifest = { exportedAt: new Date().toISOString(), pub, frozen: true, posts: [] };
  let n = 0;
  for (const [id, meta] of seen) {
    n++;
    const draft = await getDraft({ sid, publicationUrl: pub, id });
    await sleep(400);
    const files = [];
    const put = (suffix, md) => {
      const slug = safe(draft.slug || draft.draft_title || draft.title);
      const name = `${String(id)}-${slug}${suffix}.md`;
      fs.writeFileSync(path.join(postsDir, name), md, "utf8");
      files.push({ file: `posts/${name}`, sha256: sha(md), chars: md.length });
    };
    put("", draftToMarkdown(draft));
    for (const t of draft.post_translations || []) {
      const lang = String(t.language).toLowerCase();
      try {
        put(`.${lang}`, translationMarkdown(draft, lang));
      } catch (e) {
        console.log(`  [${id}] skip ${lang}: ${e.message}`);
      }
    }
    manifest.posts.push({
      id, slug: draft.slug || null,
      title: draft.draft_title || draft.title || "",
      date: draft.post_date || draft.draft_updated_at || null,
      published: !!draft.is_published,
      files,
    });
    console.log(`  [${n}/${seen.size}] ${id} ${draft.slug || ""} (${files.map((f) => f.chars).join("+")} chars)`);
  }
  manifest.corpusHash = sha(JSON.stringify(manifest.posts.map((p) => p.files.map((f) => f.sha256))));
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  fs.writeFileSync(path.join(out, "FROZEN.txt"),
    `FROZEN corpus exported ${manifest.exportedAt} from ${pub}.\n` +
    `Do NOT regenerate or "fix" these texts: they are TypoHunter's standing\n` +
    `real-world benchmark material (typos included on purpose).\n` +
    `corpusHash: ${manifest.corpusHash}\n`);
  console.log(`done: ${manifest.posts.length} posts, corpusHash ${manifest.corpusHash}`);
}

main().catch((e) => { console.error("export failed:", e.message); process.exit(1); });
