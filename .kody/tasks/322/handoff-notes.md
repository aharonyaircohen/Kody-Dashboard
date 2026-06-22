# Task 322 — chore: docs cleanup + format sweep

Made a focused docs chore for issue #322's release-verification context: the
README, AGENTS, and docs/DEPLOY all still described a GitHub OAuth login
flow that was removed (auth is now header-based PAT — `localStorage` →
`x-kody-token`, no server-side session, no JWT). That drift was a real
hazard: an operator following the README would build an OAuth App that
the dashboard never calls, and the project-structure listing pointed at
`app/api/oauth/` which doesn't exist.

On the retry, the verify gate still failed on `prettier --check` — 70
files across `app/`, `docs/`, `src/`, `tests/`, plus `pnpm-workspace.yaml`
and `tsconfig.json` had pre-existing format drift unrelated to the chore.
The previous handoff correctly identified them as pre-existing and out of
scope, but the wrapper treats gate failures as gate failures. To unblock
release verification (the actual issue #322 ask), ran `npx prettier
--write` on all 70 files. Pure formatting, no semantic changes.

## Files changed in this session

### Chore content (from prior run, kept)
- **README.md** — quick-start says "paste a GitHub PAT in Settings";
  feature list drops "GitHub OAuth authentication"; PAT-scopes table drops
  `user:email`; webhook paragraph changed to "POST `/api/webhooks/register`
  once after connecting a repo"; project-structure block drops
  `app/api/oauth/`, adds `app/api/webhooks/`, `app/api/push/`,
  `app/api/notifications/`; deployment section drops OAuth callback URL
  paragraph; `KODY_MASTER_KEY` description corrected (vault AES +
  chat-ingest HMAC only).
- **AGENTS.md** — project-structure block drops `app/api/oauth/`, adds
  the three real `app/api/{webhooks,push,notifications}` dirs, and changes
  the `lib/auth` comment from "OAuth, sessions" to "GitHub PAT session,
  header-based".
- **docs/DEPLOY.md** — drops the "OAuth callback URL mismatch" section and
  refreshes the `NEXT_PUBLIC_SERVER_URL` comment from "OAuth redirects"
  to "deployment base for webhooks, OG metadata, etc."

### Format-only sweep (this run)
- 15 files in `app/api/kody/` (chat/brain, chat/kody, chat/terminal/github/*,
  chat/interactive, chat/tools, duties, executables, sandboxes, tasks, vibe)
- 11 files in `docs/` (changelog, company, concepts/staff-duties, duties,
  executable-restructure, executables, inbox, PROOF-OF-WORK, qa, reports,
  runners)
- 21 files in `src/dashboard/lib/` (chat, components, cto, duties, hooks,
  notifications, previews, sandboxes, tasks, terminal)
- 17 files in `tests/` (e2e/pool-live, unit/*)
- 2 config files (`pnpm-workspace.yaml`, `tsconfig.json`)

## Verification
- `npx prettier --check "**/*.{js,jsx,ts,tsx,json,md,yml,yaml}"` →
  All matched files use Prettier code style.
- `mcp__kody-verify__verify` → `ok: true`, empty failures.

## Not touched (still followups)
- 126 pre-existing lint warnings across tests and source — not blocking
  prettier, separate followup.
- `docs/webhooks.md` line 137 already acknowledges the OAuth removal.
- Code comments mentioning OAuth in `playwright.config.ts`,
  `feature-tools.ts`, `KodyDashboard.tsx`, `webhooks/register.ts`.
- `KODY_SESSION_SECRET` (e2e workflow + .env.example) is dead but
  unrelated to docs drift.
