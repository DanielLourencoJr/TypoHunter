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

No runtime dependencies (nodemon is dev-only), no build step. Node.js 18+.

## Configuration (`.env`)

| Key            | Purpose                                              |
|----------------|------------------------------------------------------|
| `SUBSTACK_SID` | Your `substack.sid` session cookie (full account access — keep it local; revoke by logging out of Substack) |
| `GROQ_API_KEY` | Groq API key for proofreading. Without it, a heuristic demo mode runs |
| `GROQ_MODEL`   | Defaults to `openai/gpt-oss-120b`                    |
| `PORT`         | Defaults to `5179`                                   |

How to get `SUBSTACK_SID`: browser DevTools → Application/Storage → Cookies →
copy the `substack.sid` value while logged into Substack.

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

Run the built-in unit suite with `npm test` and the end-to-end draft review
workflow with `npm run test:e2e`. The end-to-end test serves the real app and
executes its inline UI script against the local server, while a local Substack
API stub keeps it independent of account credentials and model providers.
GitHub Actions runs both suites on Node.js 18, 20, and 22 for pushes and pull
requests.
