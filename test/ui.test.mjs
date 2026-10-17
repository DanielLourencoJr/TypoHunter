import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Evaluate the app's inline <script> (the last one, after the Tailwind CDN
// config) in a vm sandbox with minimal DOM stubs. Logic is exercised through
// the real functions — never copied — per AGENTS.md.
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const appSrc = blocks.find((b) => b.includes("function renderMarkdown"));
assert.ok(appSrc, "inline app script not found");

function makeClassList() {
  const set = new Set();
  return {
    add: (...c) => c.forEach((x) => set.add(x)),
    remove: (...c) => c.forEach((x) => set.delete(x)),
    contains: (c) => set.has(c),
    toggle: (c, force) => { const on = force === undefined ? !set.has(c) : !!force; on ? set.add(c) : set.delete(c); return on; },
  };
}
function makeEl(id) {
  return {
    id, value: "", textContent: "", innerHTML: "", disabled: false, href: "", src: "",
    style: {}, dataset: {}, classList: makeClassList(),
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, click() {},
    scrollIntoView() {}, appendChild() {}, remove() {}, setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
  };
}

const els = new Map();
const store = { getItem: () => null, setItem() {}, removeItem() {} };
const sandbox = {
  console,
  document: {
    getElementById: (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: { classList: makeClassList(), dataset: {} },
    body: { classList: makeClassList() },
  },
  window: { addEventListener() {}, scrollTo() {} },
  location: { hash: "" },
  localStorage: store,
  sessionStorage: store,
  atob: globalThis.atob,
  btoa: globalThis.btoa,
  TextDecoder,
  Uint8Array,
  setTimeout,
  clearTimeout,
};
vm.createContext(sandbox);
vm.runInContext(appSrc, sandbox, { filename: "public/index.html#script" });

const T = (name, fn) => test(name, () => fn());

T("esc: escapes the HTML-significant five", () => {
  assert.equal(sandbox.esc('a & <b> "c"'), "a &amp; &lt;b&gt; &quot;c&quot;");
});

T("splitFm: strips frontmatter, empty meta without it", () => {
  const fm = sandbox.splitFm('---\ntitle: Hi\nsubtitle: Yo\n---\nbody here');
  assert.deepEqual({ ...fm.meta }, { title: "Hi", subtitle: "Yo" });
  assert.equal(fm.body, "body here");
  const none = sandbox.splitFm("just text");
  assert.deepEqual({ ...none.meta }, {});
  assert.equal(none.body, "just text");
});

T("paragraphRanges: positions and text per paragraph", () => {
  const ranges = sandbox.paragraphRanges("aa\n\nbb\ncc");
  assert.equal(ranges.length, 2);
  assert.equal(ranges[0].text, "aa");
  assert.equal(ranges[0].startPos, 0);
  assert.equal(ranges[1].text, "bb\ncc");
  assert.equal(ranges[1].startPos, 4);
  assert.equal(ranges[1].endPos, 9);
});

T("minimalChangePair: intra-word accent highlights the whole word", () => {
  const p = sandbox.minimalChangePair("Esoterico", "Esotérico");
  assert.deepEqual({ ...p }, { oldStart: 0, oldEnd: 9, newStart: 0, newEnd: 9 });
});

T("minimalChangePair: pure insertion extends to the whole word", () => {
  const p = sandbox.minimalChangePair("cat", "cats");
  assert.equal(p.oldStart, 0);
  assert.equal(p.oldEnd, 3);
  assert.equal(p.newEnd, 4);
});

T("combinedPassageDiff: renders selected change with old/new spans", () => {
  const d = sandbox.combinedPassageDiff("the cat", [{ s: { id: "s1", original: "the", replacement: "The" }, selected: true }]);
  assert.match(d.oldHtml, /change-fragment hl-old/);
  assert.match(d.newHtml, /change-fragment hl-new/);
  assert.equal(d.appliedItems.length, 1);
});

T("renderInline: image figure, link, code, emphasis", () => {
  const out = sandbox.renderInline('see [x](https://a.co) ![alt](i.png "cap") `c` **b**');
  assert.match(out, /<a href="https:\/\/a\.co"/);
  assert.match(out, /<figure class="doc-image">/);
  assert.match(out, /<figcaption>cap<\/figcaption>/);
  assert.match(out, /<code>c<\/code>/);
  assert.match(out, /<strong>b<\/strong>/);
});

T("extractDiffImages: moves images out of the diff and keeps suggestion offsets", () => {
  const source = 'before ![alt](https://example.test/image.png "subtitle") teh after';
  const extracted = sandbox.extractDiffImages(source);
  assert.equal(extracted.text.length, source.length);
  assert.equal(extracted.images.length, 1);
  assert.match(extracted.images[0], /<img alt="alt" src="https:\/\/example\.test\/image\.png"/);
  assert.match(extracted.images[0], /<figcaption>subtitle<\/figcaption>/);
  assert.doesNotMatch(extracted.text, /example\.test|subtitle/);

  const diff = sandbox.combinedPassageDiff(extracted.text, [
    { s: { id: "s-image", original: "teh", replacement: "the" }, selected: true },
  ]);
  assert.equal(diff.appliedItems.length, 1);
  assert.doesNotMatch(diff.oldHtml + diff.newHtml, /example\.test|image\.png/);
  assert.match(diff.oldHtml + diff.newHtml, /change-fragment/);

  const placement = sandbox.reviewImagePlacement('<div class="sugwidget">suggestions</div>', extracted.images);
  assert.ok(placement.indexOf('review-media') < placement.indexOf('sugwidget'));
});

T("renderMarkdown: headings, lists, quote, code, empty", () => {
  const md = "# Title\n\n**bold**\n\n- a\n- b\n\n> quote\n\n```\nx<y\n```";
  const out = sandbox.renderMarkdown(md);
  assert.match(out, /<h1>Title<\/h1>/);
  assert.match(out, /<strong>bold<\/strong>/);
  assert.match(out, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(out, /<blockquote>quote<\/blockquote>/);
  assert.match(out, /<pre><code>x&lt;y<\/code><\/pre>/);
  assert.equal(sandbox.renderMarkdown(""), '<p class="hint">(vazio)</p>');
});

T("mediaChip: labels and escapes detail", () => {
  const chip = sandbox.mediaChip({ type: "image2", attrs: { alt: "foto" } }, false);
  assert.match(chip, /<div class="media">/);
  assert.match(chip, /Imagem/);
  assert.match(chip, /foto/);
});

T("diffHunk: highlights the changed token on both sides", () => {
  const h = sandbox.diffHunk("a teh b", { original: "teh", replacement: "the" });
  assert.match(h.oldHtml, /hl-old">teh<\/span>/);
  assert.match(h.newHtml, /hl-new">the<\/span>/);
});

T("originOf: classifies versions by note prefix", () => {
  assert.equal(sandbox.originOf({ note: "synced from Substack x" }).label, "Editor (você)");
  assert.equal(sandbox.originOf({ note: "applied 2 fixes" }).label, "Revisor");
  assert.equal(sandbox.originOf({ note: "rewind to v1" }).label, "Revisor (reversão local)");
  assert.equal(sandbox.originOf({ note: "original from Substack" }).label, "Original do Substack");
});

T("fmtEta: seconds, minutes, clamping", () => {
  assert.equal(sandbox.fmtEta(45), "45s");
  assert.equal(sandbox.fmtEta(90), "1min 30s");
  assert.equal(sandbox.fmtEta(120), "2min");
  assert.equal(sandbox.fmtEta(-5), "0s");
});

T("portugueseCount: words then fallback to digits", () => {
  assert.equal(sandbox.portugueseCount(0), "nenhuma");
  assert.equal(sandbox.portugueseCount(3), "três");
  assert.equal(sandbox.portugueseCount(11), "11");
});

T("fmtStat: em-dash for null", () => {
  assert.equal(sandbox.fmtStat(null), "—");
  assert.equal(sandbox.fmtStat(5), "5");
});

T("libCard: data-id, escaped title, audience for drafts", () => {
  const card = sandbox.libCard({ id: "12", title: "T<b>", published: false, audience: "everyone", date: "2024-01-02" });
  assert.match(card, /data-id="12"/);
  assert.match(card, /class="libcard draft-card"/, "drafts use the compact publication-card layout");
  assert.match(card, /draft-card-cover[\s\S]*?T&lt;b&gt;/, "draft card shows a fallback cover and escaped title");
  assert.match(card, /T&lt;b&gt;/);
  assert.match(card, /draft-card-audience">everyone/);
});

T("admCard: synthetic adm: id and mapped stats", () => {
  const c = sandbox.admCard({ slug: "abc", title: "T", date: "d", likes: 3, words: 10 });
  assert.equal(c.id, "adm:abc");
  assert.equal(c.published, true);
  assert.equal(c.likes, 3);
  assert.equal(c.words, 10);
});
