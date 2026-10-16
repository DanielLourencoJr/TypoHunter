import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// Verifies the frozen benchmark corpus WITHOUT regenerating it: the manifest
// hash must match a fresh recomputation, and every listed file must exist
// with the recorded sha256. This is the contract scripts/export-corpus.mjs
// produced; if it ever drifts, the A/B and quality-gate numbers are invalid.
const dir = path.dirname(fileURLToPath(import.meta.url));
const corpus = path.join(dir, "..", "testdata", "corpus");
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const manifest = JSON.parse(fs.readFileSync(path.join(corpus, "manifest.json"), "utf8"));

test("corpus manifest: frozen flag and non-empty post list", () => {
  assert.equal(manifest.frozen, true);
  assert.equal(manifest.posts.length, 47);
});

test("corpus manifest: corpusHash matches recomputation", () => {
  const recomputed = sha(JSON.stringify(manifest.posts.map((p) => p.files.map((f) => f.sha256))));
  assert.equal(recomputed, manifest.corpusHash);
});

test("corpus: every file exists and matches its recorded sha256", () => {
  for (const p of manifest.posts) {
    assert.ok(p.files.length >= 1, `post ${p.id} has no files`);
    for (const f of p.files) {
      const full = path.join(corpus, f.file);
      assert.ok(fs.existsSync(full), `missing ${f.file}`);
      const text = fs.readFileSync(full, "utf8");
      assert.equal(sha(text), f.sha256, `sha mismatch for ${f.file}`);
      assert.equal(text.length, f.chars, `char count mismatch for ${f.file}`);
    }
  }
});

test("corpus: FROZEN.txt records the corpusHash", () => {
  const txt = fs.readFileSync(path.join(corpus, "FROZEN.txt"), "utf8");
  assert.match(txt, new RegExp(manifest.corpusHash));
});
