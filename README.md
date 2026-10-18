# TypoHunter

Local-first web app that proofreads Substack drafts without breaking formatting:
fetch a draft → AI suggests typo-level fixes → accept/reject each one in a
git-style diff UI → push the result back into Substack. No copy-paste, no
rewritten voice, images and embeds preserved.

## Quick start

```bash
cp .env.example .env   # fill SUBSTACK_SID + GROQ_API_KEY (see below)
npm install            # nodemon for auto-restart during development
npm run dev            # http://localhost:5179 (restarts on code changes)
```

TypoHunter is self-contained: no sibling repositories are needed. It has no
runtime dependencies (nodemon is dev-only) and no build step. Node.js 18+.

## Configuration (`.env`)

| Key            | Purpose                                              |
|----------------|------------------------------------------------------|
| `SUBSTACK_SID` | Your `substack.sid` session cookie (full account access — keep it local; revoke by logging out of Substack) |
| `GROQ_API_KEY` | Groq API key for proofreading. Without it, a heuristic demo mode runs |
| `GROQ_MODEL`   | Defaults to `openai/gpt-oss-120b`                    |
| `GEMINI_API_KEY` | Optional second provider (free tier)              |
| `GEMINI_MODEL` | Defaults to `gemini-3.5-flash-lite`                  |
| `LLM_ORDER`    | Provider failover order; defaults to `opencode,gemini,groq` |
| `OPENCODE_API_KEY` | Credential for the OpenCode CLI provider (hosted); local runs use the CLI's own `auth.json` |
| `PORT`         | Defaults to `5179`                                   |
| `REVIEWER_SID` | Optional service account used to verify contributor access and create/remove temporary code drafts; falls back to `SUBSTACK_SID` |
| `REVIEWER_EMAIL` | Email shown in contributor setup; defaults to `substack.proofreader@proton.me` |
| `SUPPORT_EMAIL` | Optional support contact shown in setup instructions |
| `AUTH_STATE_PATH` | Optional durable path for login challenges and sessions; defaults to `data/auth-state.json` |

How to get `SUBSTACK_SID`: browser DevTools → Application/Storage → Cookies →
copy the `substack.sid` value while logged into Substack.

### Login gate

Users can enter a publication link or a Substack profile. A publication link
opens its drafts after verification. A profile shows its public authoring
publications in a selector; each publication gets its own verification code, and
the profile flow returns to a dashboard selector after login. The in-app
instructions show the reviewer email and explain how to invite it as a
**Contributor**. The verification tab is available either way. When the reviewer
account has publication access, TypoHunter creates a temporary draft whose title
contains a short verification code. The user enters that code to start a 12-hour
session for that publication. The code draft is deleted on successful sign-in
and after its 15-minute expiry. If the reviewer account cannot access the
publication, no code draft is created and the site shows the same generic code
error.

For a hosted deployment, configure `REVIEWER_SID`; the reviewer account needs
contributor access to each publication it serves. On free hosting the
filesystem is ephemeral, so the local version store and login sessions reset on
restart/redeploy. That is acceptable: the pushed content and its revision
history live in Substack's own editor history (each TypoHunter push is
attributed there), so nothing authoritative is lost. Point `AUTH_STATE_PATH` at
persistent storage only if you want sessions to survive restarts.

## Workflow

1. **Pick a publication and a post** — drafts and published posts are listed;
   posts with translations get per-edition tabs (Original, EN, …).
2. **Review** — read the rendered text, raw markdown, pending-fixes preview,
   or the committed-changes diff.
3. **Proofread** — the AI proposes minimal fixes (typos, spelling, grammar,
   punctuation only). Each shows as a red/green diff; uncheck anything that
   touches your voice.
4. **Apply** — checked fixes become a new local version. Nothing reaches
   Substack yet; every version is kept and rewound from the history.
5. **Push** — writes the version back into the Substack draft. Publishing to the
   public page is done from the Substack editor (the done screen links straight
   to it): server-side republish is off because Substack gates publishing behind
   a fresh sign-in. Translation editions of published posts can't be edited (a
   Substack limitation) and stay locked.

Edits made directly in the Substack editor are picked up automatically as
`synced from Substack` versions when the post is reopened.

## Verify a hosted deployment

`GET /api/health` (public, no secrets) reports the live commit, Node version,
configured provider names, the reviewer email, and whether the edit-check is
configured.

```bash
npm run verify:hosted -- --url https://typohunter.onrender.com
# --deep proves the reviewer identity can still edit the test publication
# (needs REVIEWER_SID in .env): it creates and immediately deletes one
# throwaway draft there, leaving nothing behind.
npm run verify:hosted -- --url https://typohunter.onrender.com --deep
# --pipeline runs the REAL suggestions pipeline on a one-typo sample and reports
# which provider/model served it; --only pins a single provider (needs
# REVIEWER_SID), e.g. to prove the deployed app's OpenCode provider works:
npm run verify:hosted -- --url https://typohunter.onrender.com --pipeline --only opencode
```

`npm run test:hosted:ui` runs the browser navigation spec against the deployed
URL (override with `BASE_URL=…`); its API calls are mocked, so it needs no
credentials.

## Tests and CI

Run `npm test` for unit and integration tests. For `npm run test:e2e`, install
the Playwright browser once with `npx playwright install chromium`, then run the
main draft review and browser navigation flows. They use a mocked Substack API
and need no credentials. GitHub Actions installs Chromium and runs both suites
on Node.js 18, 20, and 22. Vendored Substack library sources and their upstream
revisions are recorded in [`lib/VENDORED.md`](lib/VENDORED.md).
