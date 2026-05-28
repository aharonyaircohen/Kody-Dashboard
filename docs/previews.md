# PR previews on Fly Machines

Per-PR preview hosting that replaces Vercel preview deployments.
**Production stays on Vercel** — only previews move to Fly.

## Why

Vercel charges for previews per build minute (Build CPU is 96% of the
historical bill) and gates Turbopack behind the $0.126/min Turbo tier.
On Fly: builds run on Fly's hosted remote builder (cheap), Turbopack is
free, and suspended preview machines cost ~$0.

## Three-component architecture

| Component               | Responsibility                            |
| ----------------------- | ----------------------------------------- |
| Dashboard               | Orchestrate lifecycle, manage webhooks    |
| Preview builder (Fly)   | Clone repo + ref → build image            |
| Preview machines (Fly)  | Boot the built image and serve traffic    |

**Consumer repos stay zero-touch** — no Dockerfile, no workflow, no
secrets in the consumer repo. The builder ships a default
`Dockerfile.preview` and the dashboard handles auth.

## Dashboard side (`src/dashboard/lib/previews/`)

```
fly-previews.ts        Fly Machines REST + GraphQL client
preview-key.ts         Deterministic kp-<owner>-<repo>-pr-<n> naming
builder-client.ts      Calls kody-preview-builder, shared-key auth via KODY_MASTER_KEY
preview-pool.ts        Warm-pool client (mirrors runners/pool-client.ts contract)
preview-lifecycle.ts   build → pool fast path → create-fresh fallback
config.ts              Per-repo vault → FlyPreviewConfig
webhook.ts             PR closed → destroyPreview
```

API routes (`app/api/kody/previews/`):

| Method | Path                                  | Purpose                |
| ------ | ------------------------------------- | ---------------------- |
| POST   | `/`                                   | Create or refresh      |
| GET    | `/:owner/:name/:pr`                   | Status + URL           |
| DELETE | `/:owner/:name/:pr`                   | Destroy (idempotent)   |

Webhook: `app/api/webhooks/github/route.ts` calls `handlePrClosed` on
`pull_request.closed` — no separate webhook receiver.

## Preview builder (`builder/`)

Tiny Hono service that runs on its own Fly app
(`kody-preview-builder`). One endpoint: `POST /build`.

```
{ repo, ref, appName, flyToken, githubToken? }
  1. Clones <repo> at <ref> into /tmp
  2. Drops in bundled default Dockerfile.preview if the repo has none
  3. Runs `flyctl deploy --build-only --remote-only` against <appName>
     (Fly's hosted remote builder does the real Docker build, so this
      service stays small — no docker daemon, no BuildKit)
  4. Returns { image: "registry.fly.io/<appName>:<tag>", durationMs }
```

Auth: `X-Builder-Auth` shared key derived from `KODY_MASTER_KEY` via
HKDF-style purpose-prefix hash. Both dashboard and builder derive the
same key independently — nothing travels over env vars or the wire.

Deploy:

```bash
flyctl deploy -c builder/fly.toml --app kody-preview-builder
flyctl secrets set KODY_MASTER_KEY=... --app kody-preview-builder
```

## URL routing

Each PR gets its own Fly app, named deterministically:

```
kp-<sha256(owner)[0..6]>-<sha256(repo)[0..6]>-pr-<n>
```

Fly auto-issues HTTPS for `<app-name>.fly.dev`. No DNS work, no certs
to manage.

## Lifecycle

```
PR opened/synced
  → dashboard webhook OR caller hits POST /api/kody/previews { repo, pr, ref }
  → dashboard creates the per-PR Fly app (if missing)
  → dashboard calls builder /build { repo, ref, appName, flyToken }
  → builder clones, runs flyctl --remote-only, returns image ref
  → dashboard tries warm pool (~3s) → falls back to create-fresh (~40s)
  → returns { url, image, machineId, state, source, buildMs }

PR closed
  → GitHub webhook → dashboard → DELETE preview → app destroyed
```

## Vibe mode "wait + chain"

When Vibe opens a draft PR, the dashboard can pre-warm the build by
calling `POST /api/kody/previews` immediately with the default branch
as `ref`. Fly's remote builder caches layers in its registry across
builds for the same app, so when the agent commits and a second build
runs against the new ref, the deps + base layers are already cached
and the build runs ~4× faster (e.g. A-Guy: 5 min cold → ~1 min warm).

## Per-repo billing

The dashboard reads `FLY_API_TOKEN` from the **target repo's** secrets
vault (`.kody/secrets.enc`). Each repo's previews are billed to that
repo's Fly account. Matches the per-repo-infra rule.

If a repo has no `FLY_API_TOKEN` in its vault, the dashboard returns
503 `fly_token_missing`. Webhook teardown is a silent no-op.

## Testing

```bash
FLY_API_TOKEN=... pnpm vitest run tests/int/previews-live.int.spec.ts
```

Boots `flyio/hellofly` directly (skips the builder via the
`image` body field), verifies the URL serves 200 over HTTPS, destroys
the app. Auto-skips when `FLY_API_TOKEN` is not set. Costs < $0.01.
