# GitHub webhooks

The dashboard receives GitHub webhooks to invalidate its in-memory
cache the moment a resource changes, instead of waiting for the next
poll. This is the foundation of the push-based architecture that keeps
the shared GitHub token off the rate-limit ceiling (see
[CLAUDE.md](../CLAUDE.md) → "GitHub API rate-limit rules").

There is **no shared secret**. The receiver authenticates deliveries by
checking the source IP against the CIDR ranges GitHub publishes at
`https://api.github.com/meta`. TCP+TLS make spoofing those addresses
infeasible from the public internet, and the worst case for a forged
delivery is one extra (ETag-cheap) read against GitHub — so IP
verification is sufficient auth for a cache-invalidation endpoint.

## How it works

```
   GitHub repo                          Dashboard (Vercel)
┌──────────────┐  POST /api/webhooks/github  ┌──────────────────────────┐
│  resource    │────────────────────────────▶│ getClientIp(headers)     │
│  changes     │   X-GitHub-Event             │   x-forwarded-for[0]     │
│  (issue, PR, │   X-GitHub-Delivery          │   → isFromGitHub(ip)     │
│   push, …)   │                              └───────────┬──────────────┘
└──────────────┘                                          │
                                       not in hooks[] CIDR │  in CIDR
                                              ┌────────────┴───────┐
                                              ▼                    ▼
                                      403 forbidden        dedupe by
                                                       X-GitHub-Delivery
                                                       (in-memory LRU, 512)
                                                              │ new
                                                              ▼
                                                   dispatch(eventType)
                                              ┌───────────────┴───────────────┐
                                              ▼                               ▼
                                   invalidate*Cache(...)          fire-and-forget:
                                   (issue / PR / branch /         dispatchMentionPushes
                                    workflow / discussion)        dispatchNotifications
                                                                  dispatchStaffMentions
                                                              │
                                                              ▼
                                                       200 { ok, handled }
```

### Receiver: `POST /api/webhooks/github`

[`app/api/webhooks/github/route.ts`](../app/api/webhooks/github/route.ts)

1. **IP check.** `getClientIp` reads the first entry of
   `x-forwarded-for` (falling back to `x-real-ip`). `isFromGitHub` matches
   it against the `hooks[]` CIDR list. No match → **403** `{ error:
"forbidden" }`.
2. **Dedupe.** GitHub may deliver the same event more than once. The
   `X-GitHub-Delivery` id is tracked in a per-instance `Set` capped at
   512 entries; a repeat returns **200** `{ ok: true, dedup: true }`
   without re-processing. (Cross-instance duplicates are harmless —
   invalidation is idempotent.)
3. **Parse.** Bad JSON body → **400** `{ error: "invalid JSON" }`.
4. **Dispatch.** `dispatch(eventType, payload)` switches on the event
   type and calls the matching cache invalidator (table below).
5. **Side effects (fire-and-forget).** When the payload is an object, the
   receiver also calls `dispatchNotifications` (Slack/Discord rules),
   `dispatchMentionPushes` (web push to `@`-mentioned users — see
   [push.md](./push.md)), and `dispatchStaffMentions` (`@agent` →
   worker tick). All three swallow their own errors so a failed side
   effect never makes GitHub retry the delivery.
6. **Respond.** **200** `{ ok: true, handled }` (`handled` is `false` for
   event types with no matching case, e.g. an unexpected event).

A handful of events trigger extra fire-and-forget side effects inside
`dispatch` itself: `issue_comment` with a `Verdict` marker applies a
ui-verify label, `pull_request` `closed`+`merged` appends to
`CHANGELOG.md`, and `release` `published` promotes `[Unreleased]`.

### Event → cache invalidation map

| Event(s)                                                             | Action                                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `ping`                                                               | No-op (acknowledged as handled)                                                                              |
| `issues`                                                             | `invalidateIssueCache(issue.number)`                                                                         |
| `issue_comment`                                                      | `invalidateIssueCache(issue.number)` (+ ui-verify verdict label)                                             |
| `pull_request`, `pull_request_review`, `pull_request_review_comment` | `invalidatePRCache()`, `invalidatePRBehindCache()`, `invalidateIssueCache(pr.number)` (+ changelog on merge) |
| `release`                                                            | Promote `CHANGELOG.md` `[Unreleased]` on `published` (no cache flush)                                        |
| `check_run`                                                          | `invalidateWorkflowCache()` (ui-verify auto-dispatch is disabled)                                            |
| `workflow_run`, `workflow_job`, `check_suite`                        | `invalidateWorkflowCache()`                                                                                  |
| `push`, `create`, `delete`                                           | `invalidateBranchCache()`, `invalidatePRBehindCache()`                                                       |
| `discussion`, `discussion_comment`                                   | `invalidateDiscussionCache()`                                                                                |
| `repository`                                                         | `invalidateDiscussionCache()` (repo capability changes)                                                      |
| anything else                                                        | `{ handled: false }`                                                                                         |

### IP verification

[`src/dashboard/lib/webhooks/github-ip.ts`](../src/dashboard/lib/webhooks/github-ip.ts)

- Fetches `https://api.github.com/meta` and reads its `hooks[]` array.
- Caches the CIDR list **in-memory for 24h**, with in-flight dedup so a
  cache miss doesn't fire concurrent meta fetches. If the meta endpoint
  is unreachable and there's no cached list, `isFromGitHub` returns
  `false` (fail closed → 403).
- Matches both **IPv4** and **IPv6** CIDRs. IPv4-mapped IPv6 addresses
  (`::ffff:140.82.115.42`) and IPv6 zone ids (`fe80::1%eth0`) are
  normalized before matching.
- The same module exposes `isFromGitHubActions` (the `actions[]` ranges),
  used by `/api/kody/events/ingest` — a separate cache, same trust model.

### Registrar: `ensureWebhook`

[`src/dashboard/lib/webhooks/register.ts`](../src/dashboard/lib/webhooks/register.ts)

Idempotent. Lists the repo's hooks, finds the one whose `config.url`
**path** is `/api/webhooks/github` (matched by path, not full URL, so a
preview/prod URL change reuses the same canonical hook), and either:

- **PATCHes** it (`active: true`, refreshed events, no `secret` field), or
- **POSTs** a new `web` hook if none exists.

The hook config is `{ url, content_type: "json", insecure_ssl: "0" }` —
deliberately **no `secret`**, since verification is by source IP. The
caller's PAT must have **`admin:repo_hook`** scope (included in the
classic `repo` scope).

The default subscribed events (`DEFAULT_WEBHOOK_EVENTS`):

```
issues, issue_comment, pull_request, pull_request_review,
pull_request_review_comment, workflow_run, workflow_job, check_run,
check_suite, push, create, delete, discussion, discussion_comment,
repository, release
```

### Registration endpoint: `POST /api/webhooks/register`

[`app/api/webhooks/register/route.ts`](../app/api/webhooks/register/route.ts)

Manual entry point — POST it **after login** to register or refresh the
webhook for the connected repo. (Auto-registration on the OAuth callback
was removed when dashboard auth became header-based PAT.)

- **Auth:** `x-kody-token` header (required; **401** if missing). Optional
  `x-kody-owner` / `x-kody-repo`.
- **Body (optional):** `{ owner?, repo?, events? }`. Resolution order is
  body → `x-kody-*` headers → build-time `GITHUB_OWNER` / `GITHUB_REPO`.
  Omitting `events` uses `DEFAULT_WEBHOOK_EVENTS`.
- The hook URL is derived from the public base URL +
  `/api/webhooks/github`.
- **Responses:** `201` (created) / `200` (existing hook PATCHed), both
  `{ ok, hookId, created, url }`. On failure, `403`/`404` are passed
  through from GitHub; anything else maps to `502`.

## Known limitation

Cache invalidation only affects the **Vercel instance that received the
delivery**. Other instances keep serving cached data until their own TTL
expires — this is by design, as a backstop. The follow-up is to swap the
in-memory cache for Vercel's Data Cache (`fetch` + `revalidateTag`) for
cross-instance invalidation without adding a database.

## File reference

| File                                                                                    | Purpose                                                                         |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`app/api/webhooks/github/route.ts`](../app/api/webhooks/github/route.ts)               | Receiver: IP check → dedupe → dispatch cache invalidation + side effects        |
| [`app/api/webhooks/register/route.ts`](../app/api/webhooks/register/route.ts)           | Manual registration endpoint (`POST` after login)                               |
| [`src/dashboard/lib/webhooks/github-ip.ts`](../src/dashboard/lib/webhooks/github-ip.ts) | Source-IP verification against GitHub's `hooks[]`/`actions[]` CIDRs (24h cache) |
| [`src/dashboard/lib/webhooks/register.ts`](../src/dashboard/lib/webhooks/register.ts)   | `ensureWebhook` registrar + `DEFAULT_WEBHOOK_EVENTS`                            |

## FAQ

**Why no webhook secret?**

The endpoint only invalidates cache. A forged delivery costs at most one
ETag-cheap GitHub read, and faking a GitHub source IP over TCP+TLS is
infeasible. So IP verification carries the auth, and there's one fewer
env var to manage. (The engine event ingest endpoint uses the same model
with GitHub's `actions[]` ranges.)

**What if `api.github.com/meta` is down?**

If there's no cached CIDR list, `isFromGitHub` returns `false` and the
delivery is rejected with 403 (fail closed). Once the 24h cache is warm,
a transient meta outage doesn't affect verification.

**Do I need to register a webhook for every deployment URL?**

No. `ensureWebhook` matches the existing hook by URL **path**, not full
URL, so re-registering from a new preview/prod URL migrates the single
canonical hook's `config.url` instead of stacking duplicates.

**The dashboard still shows stale data after a change — why?**

Most likely the change landed on a different Vercel instance than the one
you're reading from (see **Known limitation**), or the event type has no
invalidation case. Within a single instance, the cache is cleared on
delivery and the next read is fresh.

**Can I subscribe to a new event type?**

Add it to `DEFAULT_WEBHOOK_EVENTS`, add a `case` in `dispatch` that calls
the right `invalidate*Cache` helper, then re-POST `/api/webhooks/register`
to refresh the hook's event list on GitHub.
