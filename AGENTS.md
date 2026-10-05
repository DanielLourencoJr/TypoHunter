# AGENTS.md — SubstackDraftReviewer

Local-first web reviewer for Substack drafts: fetch draft → Groq proofread (typos only) →
per-fix accept/reject diff UI → push back via internal API. No deps, no build, no tests.

## Run / verify

- `node server.js` → `http://localhost:5179`. UI-only edits (`public/index.html`,
  served from disk per request) need no restart; `server.js` / `lib/*.js` do.
- No test suite. Verify with `node --check <file>`. For `public/index.html`,
  extract the `<script>` block and `node --check` it; logic-test pure functions
  by evaluating the extracted script in node with DOM stubs
  (`document.querySelectorAll/getElementById`), never by copying functions.
- Sibling lib reused via relative import: `../SubstackCLI/lib/{drafts,convert,md,frontmatter,auth}.js`.
  Never reimplement converters; run node from this repo root so `../SubstackCLI` resolves.

## Credentials (never print, never commit)

- `.env` (gitignored) holds `SUBSTACK_SID` + `GROQ_API_KEY` + `GROQ_MODEL=openai/gpt-oss-120b`.
  Experiments use the TEST account: `/mnt/HD/Junior/Projects/.substack.test.env`
  (pub `danielloureno.substack.com`). MAIN (`danielloureno1`) is LIVE — read-only
  probes only, and never echo secret values into tool output (they land in logs).
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
  UI renders them as media chips via sentinel swap (`\u0000DIFn\u0000`).

## Gotchas

- Groq `openai/gpt-oss-120b` rejects `response_format: json_object` (HTTP 400
  `json_validate_failed`). Prompt JSON-only and tolerate fences/prose in parse.
- Never write literal NUL bytes in JS regex source (they mangle to U+FFFD);
  always use the `\u0000` escape.
- `node --check` catches syntax only; re-read edited regions for dropped
  declarations (has happened twice in this file's history).
- Commits: short imperative one-liners, no PR process in this repo.
