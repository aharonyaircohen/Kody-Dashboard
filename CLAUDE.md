# Kody Dashboard — Operations UI

Next.js dashboard for monitoring and managing the Kody CI/CD pipeline.

## Architecture

- **Pages** (`app/`) — Next.js App Router pages and API routes
- **Components** (`src/dashboard/lib/components/`) — React UI components
- **Hooks** (`src/dashboard/lib/hooks/`) — Custom React hooks
- **Auth** (`src/dashboard/lib/auth/`) — GitHub OAuth authentication
- **API** (`app/api/kody/`) — Backend API routes for GitHub, tasks, chat, pipelines

## Quick Commands

### Development

- `pnpm dev` — Start dashboard at http://localhost:3333
- `pnpm build` — Build for production
- `pnpm typecheck` — Type check
- `pnpm lint` / `pnpm lint:fix` — Lint
- `pnpm format:check` / `pnpm format` — Format

## Environment Variables

The dashboard intentionally keeps the env-var surface tiny. Only **one** secret
is required; everything else is either a non-secret config knob, or lives in
the dashboard's Settings page (user-scoped, not Vercel-scoped).

| Variable                  | Required | Purpose                                                                                                                                                                                                                                                                                                          |
| ------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KODY_MASTER_KEY`         | Yes      | 32-byte hex/base64 secret. Powers per-repo secrets vault AES-256-GCM (`vault/crypto.ts`) and chat-ingest HMAC (`chat-token.ts`). Each consumer purpose-prefixes the key before hashing — `kody-chat-token:`, `kody-token-encryption:` — so they're cryptographically separated. Generate with `pnpm vault:init`. |
| `GITHUB_TOKEN`            | Yes      | Server-side GitHub API token for tasks that run without a logged-in user (cron, webhook flows). Needs `repo` + `workflow` scope.                                                                                                                                                                                 |
| `KODY_CHAT_WORKFLOW_REPO` | No       | Central engine repo for chat (default: the connected repo from the user's stored credentials).                                                                                                                                                                                                                   |
| `KODY_CHAT_WORKFLOW_ID`   | No       | Chat workflow file name (default: `kody.yml`).                                                                                                                                                                                                                                                                   |
| `JINA_API_KEY`            | No       | Jina Reader key for the `fetch_url` tool (falls back to anonymous tier).                                                                                                                                                                                                                                         |
| `NEXT_PUBLIC_SERVER_URL`  | Dev      | Public URL for callbacks — set in dev only.                                                                                                                                                                                                                                                                      |

> **Web Push VAPID keys are NOT a separate env var.** They're derived
> deterministically from `KODY_MASTER_KEY` via HKDF (info: `kody-vapid:v1`).
> See [src/dashboard/lib/push/vapid-keys.ts](src/dashboard/lib/push/vapid-keys.ts).
> Rotate by bumping the info string to `:v2` (every existing subscription
> becomes invalid, users have to re-enable). Inspect the derived keypair
> with `KODY_MASTER_KEY=... pnpm push:init`.

**Do NOT add `FLY_API_TOKEN` (or `FLY_IO_TOKEN`) as a Vercel env var.** The
Fly Machines token is a **repo-scoped** credential, managed only on the
`/secrets` page (vault `FLY_API_TOKEN`). Server code resolves it from the
vault via `resolveFlyContext` / `getSecret`; there is no
`x-kody-fly-token` header. The Settings page → Fly Runner card owns only
the **performance tier** (`flyPerf`, per-user localStorage, sent as
`x-kody-fly-perf`) plus a read-only "token configured?" probe — it does
not store the token (that would duplicate the vault entry).

## Secrets vault (`/secrets`)

Dashboard-managed alternative to Vercel env vars. Each connected repo has
its own encrypted blob at `.kody/secrets.enc`. Values written via the
`/secrets` page are AES-256-GCM-encrypted with `KODY_MASTER_KEY` (one
shared Vercel env var, separate from session/OAuth secrets) and
committed to the repo. Runtime code reads them via
[`getSecret`](src/dashboard/lib/vault/get-secret.ts), which falls
through to `process.env` when the vault is missing or unconfigured.

- Crypto: [src/dashboard/lib/vault/crypto.ts](src/dashboard/lib/vault/crypto.ts)
- Store (read/write + 60s cache): [src/dashboard/lib/vault/store.ts](src/dashboard/lib/vault/store.ts)
- API: [app/api/kody/secrets/route.ts](app/api/kody/secrets/route.ts), [app/api/kody/secrets/[name]/route.ts](app/api/kody/secrets/[name]/route.ts)
- UI: [src/dashboard/lib/components/SecretsManager.tsx](src/dashboard/lib/components/SecretsManager.tsx)

Bootstrap: `pnpm vault:init` prints a fresh key. Paste into Vercel env
**and** a password manager — losing the key means re-entering every
secret (third-party API keys can be reissued; treat as inconvenience,
not data loss). Engine workflows (`kody.yml`) are unchanged and still
read from GitHub Actions secrets — the vault is dashboard-runtime only.

## Web Push notifications (PWA / mobile)

The dashboard ships with a service worker + manifest so it installs as a
PWA. When a user enables push from Notification Settings, the browser
subscribes to the OS push service (APNs on iOS 16.4+, FCM on Android) and
the dashboard stores the resulting `PushSubscription` in a per-repo
`kody:push-subscriptions` manifest issue. The `web-push` channel adapter
loads that list and fans out to every subscribed device whenever a rule
matches — same dispatch path as Slack/Discord, just N destinations.

- PWA shell: [public/manifest.json](public/manifest.json), [public/sw.js](public/sw.js), [public/icon.svg](public/icon.svg)
- Service worker register: [src/dashboard/lib/push/ServiceWorkerRegister.tsx](src/dashboard/lib/push/ServiceWorkerRegister.tsx) (mounted in [app/KodyProviders.tsx](app/KodyProviders.tsx))
- Channel adapter: [src/dashboard/lib/notifications/channels/web-push.ts](src/dashboard/lib/notifications/channels/web-push.ts) — signs with VAPID, prunes 404/410 endpoints
- Subscriptions manifest: [src/dashboard/lib/push.ts](src/dashboard/lib/push.ts) (types/parser) + [src/dashboard/lib/push-server.ts](src/dashboard/lib/push-server.ts) (CAS-based mutator)
- API: [app/api/push/public-key/route.ts](app/api/push/public-key/route.ts) (GET VAPID public), [app/api/push/subscribe/route.ts](app/api/push/subscribe/route.ts) (POST/DELETE per-device)
- UI: [src/dashboard/lib/push/PushToggle.tsx](src/dashboard/lib/push/PushToggle.tsx) + [src/dashboard/lib/push/usePushSubscription.ts](src/dashboard/lib/push/usePushSubscription.ts) (mounted inside `NotificationPreferences`)

No bootstrap needed: VAPID keys are derived from `KODY_MASTER_KEY` (already
required). `pnpm push:init` just inspects the derived keypair if you want
to share the public key with an external sender, or sanity-check after a
rotation.

iOS catch: Safari only allows push from installed PWAs. Users must
**Share → Add to Home Screen** first, open Kody from the icon, then tap
Enable. The UI surfaces this as the `needs-pwa` state with an inline hint.

### Extending push to a new feature

Two paths, depending on where the new feature stores comments/mentions:

1. **Backed by GitHub** (issues, PRs, comments, discussions, reviews) →
   **automatic.** The webhook receiver routes the event through
   [`dispatchMentionPushes`](src/dashboard/lib/push/mention-dispatch.ts).
   Already wired event types: `issues`, `pull_request`, `issue_comment`,
   `pull_request_review`, `pull_request_review_comment`, `commit_comment`,
   `discussion`, `discussion_comment`. **New GitHub event type needs a
   case** in `extractEvent` — pick the right `action` filter (usually
   `created`/`opened`/`edited`), pull `body` / `author` / `html_url` /
   `title` out of the payload. If the webhook hook on the repo doesn't
   subscribe to the new event yet, POST `/api/webhooks/register` once
   to refresh the event list (see
   [src/dashboard/lib/webhooks/register.ts](src/dashboard/lib/webhooks/register.ts)).

2. **Dashboard-native** (mention stored only in dashboard state, no
   GitHub artifact) → **manual call.** Import `dispatchMentionPushes`
   from the write path that persists the mention and call it with a
   synthetic event payload (`{ body, action: "created", repository: {...},
comment: { body, user, html_url } }`). Prefer routing through GitHub
   when feasible — every backed-by-GitHub feature gets push, Slack,
   webhooks, and audit history for free.

## GitHub webhooks (push-based cache invalidation)

To replace polling with push, the dashboard receives webhooks from GitHub
and invalidates its in-memory cache when resources change. **No shared
secret needed.** The receiver verifies the source IP against GitHub's
published webhook CIDR ranges (`https://api.github.com/meta`); deliveries
from anywhere else return 403.

- IP verification: [src/dashboard/lib/webhooks/github-ip.ts](src/dashboard/lib/webhooks/github-ip.ts)
  — fetches and caches the CIDR list for 24h, with IPv4/IPv6 matching.
- Receiver: [app/api/webhooks/github/route.ts](app/api/webhooks/github/route.ts)
  — verifies IP, dedupes by `X-GitHub-Delivery`, dispatches to
  `invalidateIssueCache` / `invalidatePRCache` / `invalidateWorkflowCache`
  / `invalidateBranchCache` based on event type.
- Registrar: [src/dashboard/lib/webhooks/register.ts](src/dashboard/lib/webhooks/register.ts)
  — shared `ensureWebhook` helper. Idempotent: lists existing hooks on the
  repo and PATCHes the matching one or creates a new one. Caller's PAT
  must have `admin:repo_hook` (the classic `repo` scope already includes it).
  - Manual endpoint: [app/api/webhooks/register/route.ts](app/api/webhooks/register/route.ts)
    — POST after login to register the webhook for the connected repo.
    (Auto-registration on the OAuth callback was removed along with the
    OAuth flow; dashboard auth is header-based PAT now.)

Subscribed events: `issues`, `issue_comment`, `pull_request`,
`pull_request_review`, `pull_request_review_comment`, `workflow_run`,
`workflow_job`, `check_run`, `check_suite`, `push`, `create`, `delete`.

Invalidation only affects the receiving Vercel instance — other instances
serve cached data until their TTL expires (by design, as a backstop).
Follow-up: swap the in-memory cache for Vercel's Data Cache (`fetch` +
`revalidateTag`) for cross-instance invalidation without adding a database.

## Chat flow

The dashboard has **three** chat backends, picked by the UI's `selectedAgentId`
(a fresh composer initializes to `'kody-live'` — `lockedAgentId ?? "kody-live"`
in [KodyChat.tsx](src/dashboard/lib/components/KodyChat.tsx) — unless the host
pins one). The in-process `kody` path is the fast, no-runner option and the
fallback when an id doesn't resolve (`getAgent()` → `AGENT_KODY`).

| `selectedAgentId`               | Endpoint                                                       | Backend                                  | System prompt lives in                                                                   |
| ------------------------------- | -------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `kody`                          | [`/api/kody/chat/kody`](app/api/kody/chat/kody/route.ts)       | In-process chat model via the AI SDK     | [`src/dashboard/lib/agents.ts`](src/dashboard/lib/agents.ts) (`AGENT_KODY.systemPrompt`) |
| `brain` / `brain-fly`           | [`/api/kody/chat/brain`](app/api/kody/chat/brain/route.ts)     | External Brain chat server (proxied)     | Brain server profile (out of repo)                                                       |
| `kody-live` (**default**), else | [`/api/kody/chat/trigger`](app/api/kody/chat/trigger/route.ts) | GitHub Actions + `@kody-ade/kody-engine` | `kody2/src/chat/loop.ts` (`CHAT_SYSTEM_PROMPT`)                                          |

The legacy `/api/kody/chat` endpoint is deprecated and returns 410.

### Slash commands (`/commands`)

The chat composer has a slash-command menu. Typing `/` opens a filtered
list of prompts; selection inserts `/<slug> ` so the user can add
arguments before Enter. On send, `expandSlashCommand` substitutes
`$ARGUMENTS` / `$0` / `$1` into the prompt body and ships the rendered
text — every backend just sees a normal user message, so commands work
identically on the in-process chat model, Brain, and Engine.

Two layers, merged at runtime:

- **Built-ins** ship in [src/dashboard/lib/commands/builtins.ts](src/dashboard/lib/commands/builtins.ts) (`/plan`, `/research`, `/review`, `/explain`, `/issue`, `/goal`, `/analyze`, `/duty`, `/init`). `/research`, `/plan`, and `/issue` follow the research-first flow enforced by the kody-live system prompt; `/issue` ends with an opt-in `kody_run_issue` handoff.
- **Repo commands** live at `.kody/commands/<slug>.md` (frontmatter: `description`, `argument-hint`; body is the template). Repo wins on slug collision — that's how "fork the built-in" works.

Drop `.kody/commands/.disable-builtins` to suppress every built-in for the repo.

- Storage helpers: [src/dashboard/lib/commands/files.ts](src/dashboard/lib/commands/files.ts)
- Merge + substitution: [src/dashboard/lib/commands/index.ts](src/dashboard/lib/commands/index.ts), [src/dashboard/lib/commands/substitute.ts](src/dashboard/lib/commands/substitute.ts)
- API: [app/api/kody/commands/route.ts](app/api/kody/commands/route.ts), [app/api/kody/commands/[slug]/route.ts](app/api/kody/commands/[slug]/route.ts)
- UI: [app/(chat-rail)/commands/page.tsx](<app/(chat-rail)/commands/page.tsx>), [src/dashboard/lib/components/CommandsManager.tsx](src/dashboard/lib/components/CommandsManager.tsx)
- Chat wiring: [src/dashboard/lib/components/SlashCommandMenu.tsx](src/dashboard/lib/components/SlashCommandMenu.tsx), [src/dashboard/lib/commands/useSlashCommands.ts](src/dashboard/lib/commands/useSlashCommands.ts)
- Full docs: [docs/commands.md](docs/commands.md)

Important: Claude Code's `` !`shell` `` injection is **not** supported.
That's a CLI preprocessing feature (it shells out before the message is
sent); the dashboard server has no working tree to shell into. Stick to
plain text + `$ARGUMENTS` for portable prompts.

**Engine path details** (when used): dispatches `kody.yml` in the connected
repo with the session ID and an inline HMAC token in `dashboardUrl`. The kody
engine runs `kody-engine dispatch`, which branches to the chat executable, streams
events back to `/api/kody/events/ingest` (real-time), and commits them to
`.kody/events/{sessionId}.jsonl` (durable fallback, polled by
`/api/kody/events/stream`). Token is verified via HMAC of sessionId with
`KODY_MASTER_KEY` — no shared DB lookup.

## Deployment

The production URL is whatever your Vercel project resolves to — set
`NEXT_PUBLIC_SERVER_URL` to that value so webhook registration and OG
metadata point at it instead of latching onto a preview URL.

### Vercel CLI

```bash
export PATH="/opt/homebrew/bin:$PATH"  # macOS fix for node path
vercel --prod  # Deploy to production
```

## Import Aliases

```typescript
import { ... } from '@dashboard/...'    // src/dashboard/
import { ... } from '@/...'             // src/
```

## GitHub API rate-limit rules (do not break)

The polling token is shared across all dashboard users (5000 REST req/hr per
token). When the budget is drained the entire dashboard goes dark — the same
window that just blew up takes ~1 hour to reset. Every cache miss matters.

These rules are load-bearing — past regressions of any of them have caused
multi-hour outages. Read [src/dashboard/lib/github-client.ts](src/dashboard/lib/github-client.ts) before changing anything in this file.

1. **Never add `noCache: true` to a polled endpoint to "fix staleness."**
   Bypassing the cache turns every poll into a fresh GitHub call. To make
   data feel fresh, use one of:
   - Lower `ttl` (e.g. `ttl: 15_000`) — post-TTL revalidation is a free 304
     via `If-None-Match` when nothing changed.
   - `invalidateIssueCache(issueNumber)` after writes that mutate that issue
     or a manifest stored in it.
   - Client-side optimistic `setQueryData` for the writer's own UI.

2. **Every `fetchIssue` / `fetchIssues` cache miss must go through the
   ETag/`If-None-Match` path.** A cache miss with no ETag = a full read
   against the budget. With an ETag, GitHub returns 304 (free) when the
   resource is unchanged. Don't strip the `headers: { 'If-None-Match': ... }`
   plumbing.

3. **New GraphQL queries on the polling path need three things:**
   in-process cache (with TTL ≥ 60s for low-churn data), in-flight request
   dedup, and a stale fallback that _refreshes the cache TTL on error_ so
   GraphQL throttling doesn't compound. See `fetchOpenPRs` for the pattern.
   GraphQL has its own 5000-points/hr bucket and no ETag/304 escape hatch.

4. **Polling cadence ≥ 15s on any endpoint that touches GitHub.**
   Faster polling forces a token bucket reset to drain instantly when all
   tabs reconnect, restarting the 1-hour wait.

5. **After every write that mutates an issue, call `invalidateIssueCache(n)`.**
   Same-instance reads then see the change immediately without waiting for
   TTL — and without forcing every reader to bypass the cache.
