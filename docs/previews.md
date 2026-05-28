# PR previews on Fly Machines

Per-PR preview hosting that replaces Vercel preview deployments.
**Production stays on Vercel** — only previews move to Fly.

## Why

Vercel charges for previews per build minute (Build CPU is 96% of the
historical bill). Turbopack is gated behind the $0.126/min Turbo tier.
Fly Machines:

- Builds run on free GitHub Actions minutes
- Turbopack is free (your own Dockerfile, no tier)
- Suspended preview machines cost ~$0 (rootfs storage only)
- A warm pool gets time-to-URL to ~3s (vs ~40s create-fresh)

Expected savings on Vercel preview bill: ~90%.

## Architecture

Lives in two places inside the dashboard:

```
src/dashboard/lib/previews/
  fly-previews.ts        Fly Machines REST + GraphQL client
  preview-key.ts         Deterministic kp-<owner>-<repo>-pr-<n> naming
  preview-pool.ts        Warm-pool client (mirrors runners/pool-client.ts)
  preview-lifecycle.ts   Try pool, fall back to create-fresh
  config.ts              Per-repo vault → FlyPreviewConfig
  webhook.ts             PR closed → destroyPreview

app/api/kody/previews/
  route.ts                              POST   (create or refresh)
  [owner]/[name]/[pr]/route.ts          GET    (status + URL)
                                        DELETE (destroy)
```

PR webhook handler (`app/api/webhooks/github/route.ts`) calls
`handlePrClosed` on `pull_request.closed` — no separate webhook.

## URL routing

Each PR gets its own Fly app, named deterministically:

```
kp-<sha256(owner)[0..6]>-<sha256(repo)[0..6]>-pr-<n>
```

Fly auto-issues HTTPS for `<app-name>.fly.dev`. No DNS work, no certs to
manage. Vanity domain (`pr-123.previews.kody.dev`) is a future add-on:
register the domain on the Fly app + add a CNAME; Fly handles the cert.

## Lifecycle

```
PR opened/synced
  → CI builds Dockerfile.preview, pushes to registry.fly.io/kp-...:<sha>
  → CI calls POST /api/kody/previews
  → dashboard tries warm pool (~3s) → falls back to create-fresh (~40s)
  → returns { url, appName, machineId, state, source: "pool"|"fresh" }
  → CI comments URL on PR (sticky)

PR closed (merged or not)
  → GitHub webhook → dashboard → DELETE preview
  → pool reclaims slot OR app is destroyed
```

## Warm pool (`preview-pool.ts`)

The pool owner runs alongside the runners pool owner on the
`kody-litellm` Fly machine. It keeps N pre-booted, suspended Fly
machines per repo running a generic Next.js base image. When a claim
arrives:

1. Pick a free suspended machine
2. Swap its image config to the PR's just-built image
3. Unfreeze + rename the parent app to `kp-...-pr-<n>`
4. Return the new URL

**Fall-back contract** (matches the runner pool): claim NEVER throws.
Empty pool or unreachable owner → caller transparently uses
create-fresh. The pool is an accelerator, not a hard dependency.

Owner-side endpoints expected by `preview-pool.ts`:

```
POST /preview-pool/claim    → { appName, url, machineId }
POST /preview-pool/release  → ok
```

The owner implementation lives in the engine repo
(`kody2/src/scripts/previewPoolServe.ts`) — not in this repo. Falling
back gracefully keeps this dashboard module shippable before the owner
is built.

## Per-repo billing

The dashboard reads `FLY_API_TOKEN` from the **target repo's** secrets
vault (`.kody/secrets.enc`), not the dashboard's own env. Each repo's
previews are billed to that repo's Fly account. Matches the "All Fly
infrastructure must be per-repo" rule.

If a repo has no `FLY_API_TOKEN` in its vault, the dashboard returns
503 `fly_token_missing`. Webhook teardown is a silent no-op (repo
isn't opted in).

## Consumer wiring (per repo)

1. Copy `templates/previews/Dockerfile.preview` → repo root as
   `Dockerfile.preview`.
2. Copy `templates/previews/preview-build.yml` →
   `.github/workflows/preview-build.yml`.
3. In the repo's `.kody/secrets.enc` vault, add `FLY_API_TOKEN`
   (and optionally `FLY_ORG_SLUG`, `FLY_DEFAULT_REGION`).
4. Add GitHub Actions secrets: `FLY_API_TOKEN`,
   `KODY_DASHBOARD_URL`, `KODY_DASHBOARD_TOKEN`,
   `KODY_DASHBOARD_OWNER`, `KODY_DASHBOARD_REPO`.
5. Ensure `next.config.js` has `output: 'standalone'`.
6. Disable Vercel preview deployments for non-main branches.

## Build optimizations vs Vercel

| Knob              | Vercel                              | Kody previews                                  |
| ----------------- | ----------------------------------- | ---------------------------------------------- |
| Turbopack build   | Turbo tier only — $0.126/build min  | Free — `next build --turbopack` in Dockerfile  |
| Build CPU         | $0.014–$0.126/min                   | $0 (GitHub Actions free quota)                 |
| Idle preview cost | per-invocation                       | $0 — Fly Machine auto-suspends                 |
| Cold start        | ~instant (edge)                     | 1–3s (suspended wake)                          |
| HTTPS             | automatic                           | automatic (`<app>.fly.dev`)                    |

Next.js `output: 'standalone'` cuts the runtime image from ~1GB to
~150MB.

### Vibe mode "wait + chain"

The template uses `concurrency.cancel-in-progress: false` and a
per-branch BuildKit registry cache (`registry.fly.io/<app>:buildcache`).
Effect: when Vibe opens a draft PR, the `pull_request.opened` event
triggers a first build of the (empty-diff) branch. While the agent is
working, that build finishes and populates the cache layers. When the
agent commits, the `pull_request.synchronize` event queues a second
build behind the first; that second build reuses the cache and runs
~4× faster.

Concrete A-Guy example: cold build ~5 min, post-commit cache-hit build
~60–90s.

## Testing

Live integration test:

```bash
FLY_API_TOKEN=... pnpm vitest run tests/int/previews-live.int.spec.ts
```

Creates a real Fly app, verifies the URL serves 200, destroys it.
Auto-skips when `FLY_API_TOKEN` is not set so CI without Fly stays
green. Costs < $0.01 per run.
