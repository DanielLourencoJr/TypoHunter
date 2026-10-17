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

For a hosted deployment, configure `REVIEWER_SID` and put
`AUTH_STATE_PATH` on persistent storage so active sessions and pending draft
cleanup survive restarts. The reviewer account needs contributor access to each
publication it serves.

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
5. **Push** — writes the version back into the Substack draft. For already
   published posts, an extra *Republish live* checkbox updates the public page
   without sending email. Translation editions of published posts can't be
   edited (a Substack limitation) and stay locked.

Edits made directly in the Substack editor are picked up automatically as
`synced from Substack` versions when the post is reopened.

## Tests and CI

Run `npm test` for unit and integration tests. For `npm run test:e2e`, install
the Playwright browser once with `npx playwright install chromium`, then run the
main draft review and browser navigation flows. They use a mocked Substack API
and need no credentials. GitHub Actions installs Chromium and runs both suites
on Node.js 18, 20, and 22. Vendored Substack library sources and their upstream
revisions are recorded in [`lib/VENDORED.md`](lib/VENDORED.md).
