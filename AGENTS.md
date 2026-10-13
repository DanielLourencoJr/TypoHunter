# AGENTS.md — SubstackDraftReviewer

Local-first web reviewer for Substack drafts: fetch draft → Groq proofread (typos only) →
per-fix accept/reject diff UI → push back via internal API. No deps, no build, no tests.

## Run / verify

- `npm run dev` (nodemon, watches `server.js`/`lib`/`public`, ignores `data/`) →
  `http://localhost:5179`. UI-only edits (`public/index.html`,
  served from disk per request, `no-store`) need no restart either way.
- No test suite. Verify with `node --check <file>`. For `public/index.html`,
  extract the `<script>` block and `node --check` it; logic-test pure functions
  by evaluating the extracted script in node with DOM stubs
  (`document.querySelectorAll/getElementById`), never by copying functions.
- Sibling lib reused via relative import: `../SubstackCLI/lib/{drafts,convert,md,frontmatter,auth}.js`.
  Public-post HTML uses `../../SubstackKit/lib/convert/html_to_md.js` (tested,
  captions preserved). Never reimplement converters; run node from this repo
  root so `../SubstackCLI` resolves. SubstackKit is read-only by design — the
  writer flow's authenticated writes stay in SubstackCLI; never route our SID
  through `substack-api`-backed paths (third-party gateway).

## Credentials (never print, never commit)

- `.env` (gitignored) holds `SUBSTACK_SID` + `GROQ_API_KEY` + `GROQ_MODEL=openai/gpt-oss-120b`.
  `REVIEWER_SID` is the service (contributor-model) identity; central vault keeps
  `SUBSTACK_SID_REVIEWER` + `SUBSTACK_USERID_REVIEWER` + `SUBSTACK_HANDLE_REVIEWER`.
  Experiments use the TEST account: `/mnt/HD/Junior/Projects/.substack.test.env`
  (pub `danielloureno.substack.com`). MAIN (`danielloureno1`) is LIVE — read-only
  probes only, and never echo secret values into tool output (they land in logs).
- Fresh-account SIDs get HTTP 403 with non-browser User-Agents (python-urllib);
  always validate with a browser UA or node fetch. A 403 alone means nothing.
- Read-only admin lives at the hidden `#admin` route (no button), gated by
  `ADMIN_PASSWORD` (unset = disabled). It reuses the library/history/review
  screens with synthetic `adm:<slug>` ids that match no writer endpoint;
  the review screen hides apply/finish, so nothing can be written back.
- The user runs their own server on :5179. Test on other ports (`PORT=51xx`).
  Find strays with `ss -ltnp | grep <port>` + `kill <pid>` (`pkill` hangs here).
  Beware `A && B &` precedence — background the server in its own command and
  `kill $SRV` in the same call, or the shell session hangs.

## Store + invariants (`data/<id>/store.json`, gitignored)
- Shape: `{editions: {original|en|…: {versions, suggestions, pushes, lastSeen, mode}}}`.
- Versions are content states only; pushes are markers on versions (`pushes[]`),
  never new versions. `lastSeen` tracks last Substack state as a content snapshot
  `{body, title, subtitle, audience}` — full-markdown compare would false-positive
  on transport fields like the slug assigned at publish.
- Apply consumes suggestions (`suggestions = []`); stale ones (text no longer
  contains `original`) are display-partitioned, never re-offered.
- Push strips frontmatter before `mdToTiptap` or it renders as visible `---` text.
- `PUT /drafts` carries no `translations` field, so other language editions survive
  (verified live). Translation push uses `translateDraft`, which Substack rejects
  on published posts — UI disables it there.
- `<!-- substack-cli-node/inline:v1 … -->` markers must round-trip byte-identical:
  prompt forbids touching them + `filterOpaque` drops overlapping suggestions.
  Never sent raw to the model: `maskOpaque` swaps each for `[midia N: tipo]`
  (~72% fewer prompt chars on media-heavy texts). Suggestions touching URLs
  are dropped (captions share `![alt](url "caption")` syntax with links).
  UI renders them as media chips via sentinel swap (`\u0000DIFn\u0000`).

## Styling

- Tailwind via Play CDN (no build) + inline `tailwind.config` (`darkMode` follows
  our `data-theme` selector, brand orange, font stacks). Custom diff/media/widget
  CSS stays in `public/index.html`; buttons/layout are Tailwind utilities.
  App requires internet anyway (Substack + Groq), so CDN is acceptable here.

## Gotchas

- Groq `openai/gpt-oss-120b` rejects `response_format: json_object` (HTTP 400
  `json_validate_failed`). Prompt JSON-only and tolerate fences/prose in parse.
- Review prompt is composable YAML: `prompts/proofread.yaml` (`system` +
  `template` + `includes`) built from `prompts/_base.yaml` + `prompts/snippets/`
  by `buildPrompt` in `lib/proofread.js` (minimal-YAML subset, no deps);
  re-read on every analysis, so prompt edits need no restart. Media placeholder
  wording lives in `prompts/media.yaml` (no model-facing strings in code).
  Verify prompt changes with the clean control (clean PT text must return `[]`).
- Analyses run through a server-side FIFO job queue (one at a time, protects
  the TPM budget): POST proofread/analyze answers 202 `{jobId, position,
  etaSec}`; clients poll `GET /api/jobs/:id` (queued/running/done/error +
  chunk progress). ETA self-calibrates from completed jobs. Queue is
  in-memory — a restart drops it, clients re-enqueue via their retry path.
- Never write literal NUL bytes in JS regex source (they mangle to U+FFFD);
  always use the `\u0000` escape.
- `node --check` catches syntax only; re-read edited regions for dropped
  declarations (has happened twice in this file's history).
- Commits: short imperative one-liners, no PR process in this repo.
