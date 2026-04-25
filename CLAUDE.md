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

| Variable | Required | Purpose |
|----------|----------|---------|
| `KODY_SESSION_SECRET` | Yes | JWT session signing secret |
| `GITHUB_TOKEN` | Yes | GitHub API token (needs `workflows: write`) |
| `GITHUB_APP_CLIENT_ID` | Yes | GitHub OAuth App client ID |
| `GITHUB_APP_CLIENT_SECRET` | Yes | GitHub OAuth App client secret |
| `NEXT_PUBLIC_SERVER_URL` | Dev | Public URL for OAuth redirects |
| `KODY_CHAT_WORKFLOW_REPO` | No | Central engine repo for chat (default: the connected repo from login) |
| `KODY_CHAT_WORKFLOW_ID` | No | Chat workflow file name (default: `kody.yml`) |
| `JINA_API_KEY` | No | Jina Reader key for the `fetch_url` tool (falls back to anonymous tier) |

## Chat flow

Chat dispatches `kody.yml` in the connected repo with the session ID and an
inline HMAC token in `dashboardUrl`. The kody engine runs `kody dispatch`,
which branches to the chat executable, streams events back to
`/api/kody/events/ingest` (real-time), and commits them to
`.kody/events/{sessionId}.jsonl` (durable fallback, polled by
`/api/kody/events/stream`). Token is verified via HMAC of sessionId with
`KODY_SESSION_SECRET` — no shared DB lookup.

## Deployment

### Production URL

https://kody-aguy.vercel.app

### Vercel CLI

```bash
export PATH="/opt/homebrew/bin:$PATH"  # macOS fix for node path
vercel --prod  # Deploy to production
```

### OAuth Setup

The GitHub OAuth App callback URL must match:

```
https://kody-aguy.vercel.app/api/oauth/github/callback
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
   dedup, and a stale fallback that *refreshes the cache TTL on error* so
   GraphQL throttling doesn't compound. See `fetchOpenPRs` for the pattern.
   GraphQL has its own 5000-points/hr bucket and no ETag/304 escape hatch.

4. **Polling cadence ≥ 15s on any endpoint that touches GitHub.**
   Faster polling forces a token bucket reset to drain instantly when all
   tabs reconnect, restarting the 1-hour wait.

5. **After every write that mutates an issue, call `invalidateIssueCache(n)`.**
   Same-instance reads then see the change immediately without waiting for
   TTL — and without forcing every reader to bypass the cache.
