# AGENTS.md — TypoHunter

Local-first web reviewer for Substack drafts: fetch draft → LLM proofread (spelling/
grammar/punctuation/caps only — never word choice, structure, or voice) →
per-fix accept/reject diff UI → push back via internal API. No deps, no build.

## Run / verify

- `npm run dev` (nodemon, watches `server.js`/`lib`/`public`, ignores `data/`) →
  `http://localhost:5179`. UI-only edits (`public/index.html`,
  served from disk per request, `no-store`) need no restart either way.
- `npm test` (builtin `node:test`, no deps): `test/llm.test.mjs`
  (mocked `fetch`: 429 daily-vs-minute, 5xx/network transient, provider order),
  `test/proofread.test.mjs` (YAML/prompt, `maskOpaque` id stability, paragraph
  hashing, filtering, failover), `test/ui.test.mjs` (the real inline `<script>`
  evaluated in `node:vm` with DOM stubs — never copy functions),
  `test/server.test.mjs` (store migration, snapshots, queue ETA — needs the
  main-guard so importing `server.js` does not bind a port), and
  `test/corpus.test.mjs` (re-derives the frozen corpus hashes; never regenerates).
  `npm run test:e2e` starts the real server on loopback and exercises the draft
  review flow against a mocked Substack API; no account or model key is used.
  Still run `node --check <file>` on edits; for `public/index.html`, extract the
  `<script>` block and `node --check` it.
- Substack conversion and API modules are vendored under `lib/substack-cli/`
  and `lib/substack-kit/` so this repository runs standalone. They are copied
  from the sibling projects with their upstream revisions recorded in
  `lib/VENDORED.md`; preserve their behavior and update them from those sources
  when needed. The writer flow uses direct authenticated requests; never route
  our SID through `substack-api`-backed paths (third-party gateway).

## Credentials (never print, never commit)

- `.env` (gitignored) holds `SUBSTACK_SID` + `GROQ_API_KEY` + `GROQ_MODEL=openai/gpt-oss-120b`.
  Optional second provider: `GEMINI_API_KEY` (+`GEMINI_MODEL`, default
  `gemini-3.5-flash-lite` — the non-lite flash models get only **20 RPD** free
  (~4 posts/day, useless); the lite models get 500). Gemini runs with
  `reasoning_effort: "low"` — the lite models REJECT `"none"` (503/400);
  the non-lite flashes accept `"none"` and are ~6x cheaper with it. `LLM_ORDER`
  (default `opencode,gemini,groq` — OpenCode's free model leads because it is
  effectively uncapped, Gemini/Groq cover its misses; Gemini stayed cleanest in
  the quality gate but has daily caps) sets failover order; only keys
  present are used, none at all = heuristic demo. Daily-cap 429s fail over,
  never retried. Per-provider daily spend lands in `data/llm-usage.json`
  (gitignored, best-effort).
- Optional third provider: **opencode** (free tier). It is NOT an HTTP endpoint —
  the Console rejects direct calls (`403 FreeTierError: "can only be used from
  within OpenCode"`), including replays of opencode's exact User-Agent/`x-opencode-*`
  headers. So `lib/opencode-server.js` spawns a local headless
  `opencode serve --pure` and drives ITS session API (`POST /session` →
  `POST /session/:id/message` with `system` + one text part + `tools: {}` →
  `DELETE /session/:id`): a throwaway session per call so nothing leaks across
  paragraphs. Availability = the CLI is installed (`OPENCODE_BIN`, else
  `~/.opencode/bin/opencode`); no key. `OPENCODE_MODEL` defaults to
  `deepseek-v4.1-flash-free`; `OPENCODE_PORT` (default 5198) is reused across
  runs, `OPENCODE_URL` attaches to a server you already run. Only used when
  listed in `LLM_ORDER` (default `opencode,gemini,groq`, skipped when the CLI is
  absent). The session API exposes
  no temperature/max-tokens, so it is less deterministic than the HTTP
  providers, and the quality gate found it both missing a real typo and
  editing correct prose — hence not the default.
  `REVIEWER_SID` is the service (contributor-model) identity; central vault keeps
  `SUBSTACK_SID_REVIEWER` + `SUBSTACK_USERID_REVIEWER` + `SUBSTACK_HANDLE_REVIEWER`.
  `REVIEWER_EMAIL` is public setup guidance shown by the login gate. Auth
  challenges and sessions are stored in `data/auth-state.json` (or
  `AUTH_STATE_PATH`); hosted deployments must point this at persistent storage.
  Verification drafts expire after 15 minutes and are removed on successful
  verification or by the cleanup loop after expiry. Sessions last 12 hours.
  Direct publication sign-in opens its drafts. Profile sign-in lists public
  authoring publications (never subscriptions), verifies each publication
  separately, then returns to the selection dashboard.
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
- Silent review ledger (`reviewed` per edition: `paraHash -> {suggestions,
  model, promptHash, at, via}`): paragraph identity is SHA-256 of RAW bytes
  (only CRLF->LF normalized — one space difference = different paragraph).
  Only new-vintage paragraphs reach the model; batches group ADJACENT new
  paragraphs only, never mixing reviewed text. External sync never wipes the
  ledger; apply records resulting paragraphs as reviewed-empty (no re-offer,
  no re-proofread loop). Prompt/model change retires old verdicts
  (re-proofread lazily). Media placeholder id is the marker-bytes hash
  (`prompts/media.yaml`), never a positional counter.
- Frozen benchmark corpus: `testdata/corpus/` (47 posts, manifest +
  corpusHash, `FROZEN.txt`) — NEVER regenerate or "fix"; author keeps typos
  as test material. A/B context experiment: `scripts/ab-context.mjs`
  (solo vs read-only-neighbor arms, one paragraph per call both sides).
  Larger OpenCode-only sweep: `scripts/opencode-sweep.mjs` — the free model is
  uncapped so it scores many paragraphs, run CONCURRENTLY to stay quick
  (`--limit`/`--concurrency`, deterministic even spread); it reports objective
  facts only (valid JSON, edit counts, latency, tokens) and dumps the edits,
  it does NOT assign correct/wrong verdicts (no authoritative labels exist).

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
