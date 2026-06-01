# PR previews on Fly Machines

Per-PR preview hosting that replaces Vercel preview deployments.
**Production stays on Vercel** — only previews move to Fly.

## Why

Vercel's preview bill is ~96% build CPU minutes. On Fly: builds run on
Fly's own remote builder, the per-PR preview machine **suspends to
disk** when idle (~$0 cost) and wakes in ~1–2s on next request. Net
result: idle previews are essentially free; only build minutes cost.

## Architecture (one-shot builder pattern)

```
PR opened/synced
  ↓
[GitHub webhook]
  ↓
[Dashboard]
  ↓ single fast API call (~1s, Vercel→Fly)
[Builder Fly Machine] ←─ short-lived, auto-destroys when done
  ↓ owns the whole pipeline:
  ├─ git clone <repo>@<ref>
  ├─ probe GHCR for per-repo base image (optional speed-up)
  ├─ flyctl deploy --remote-only  (runs on fly-builder-<org>)
  ├─ mirror result to GHCR (if base build)
  ├─ create per-PR Fly app + allocate shared IPs
  └─ boot the preview machine
       ↓
[Preview Fly Machine] — serves https://kp-<...>-pr-<n>.fly.dev
  • suspend after idle, wake on request
```

**The dashboard never polls.** It spawns the builder and returns
immediately with the deterministic URL. Status checks (`GET
/api/kody/previews/...`) query Fly's Machines API directly.

### Components

| Component             | Lives in                            | Lifetime          |
| --------------------- | ----------------------------------- | ----------------- |
| Lifecycle / webhooks  | `src/dashboard/lib/previews/`       | Dashboard runtime |
| Builder image         | `builder/`                          | One-shot per PR   |
| Per-PR preview app    | Fly (auto-created)                  | Until PR closed   |
| Per-repo base image   | GHCR (optional)                     | Until manually rebuilt |
| Org remote builder    | `fly-builder-<org>` (Fly auto-created) | Always-on |

### Consumer repos = zero-touch

No Dockerfile, no workflow, no env vars in the consumer repo. The
builder ships two bundled templates:

- `default-Dockerfile.preview.prod` — `next build` + `next start`
  (matches Vercel's flow). **Default.**
- `default-Dockerfile.preview.dev` — `next dev` (skips build, compiles
  on first request). Opt-in via `KODY_PREVIEW_BUILD_MODE=dev` in the
  repo's vault.

## Per-repo billing

Each repo's previews bill to that repo's Fly account. The dashboard
reads `FLY_API_TOKEN` from the **target repo's** vault
(`.kody/secrets.enc`). No global Fly token.

If the vault has no `FLY_API_TOKEN`, the webhook is a silent no-op and
`POST /api/kody/previews` returns 503 `fly_token_missing`.

## Naming + URL routing

Per-PR app name is deterministic — same `(owner, repo, pr)` always
maps to the same app:

```
kp-<sha256(owner)[0..6]>-<sha256(repo)[0..6]>-pr-<n>
```

Fly auto-issues HTTPS for `<appname>.fly.dev`. No DNS, no certs.

## Build speed: GHCR base image inheritance

The slow part of every PR is `docker build` (5–13 min cold). To skip
the `pnpm install` + initial build steps per PR, the builder optionally
inherits from a pre-built per-repo base image hosted on GHCR.

Set `KODY_PREVIEW_GHCR_OWNER=<your-gh-username>` on the dashboard
(Vercel env var). On each build the builder:

1. Probes `ghcr.io/<owner>/kp-<owner-hash>-<repo-hash>-base:latest`
2. If found → patches `BASE_IMAGE` in the Dockerfile → starts FROM
   that image (deps + `.next/cache` already inside).
3. Builds + mirrors the result back to GHCR (using
   `skopeo`) when it's a base-image rebuild.

**Image must be public** for the FROM to work without auth.

Effect: PRs that don't change `package.json` go from ~13 min cold to
~3–4 min.

## Namespace remote builders (faster GitHub-path builds)

On the **GitHub Actions** build path (`runPreviewBuild` in the engine,
dispatched as `executable=preview-build`), the per-PR `docker build` can
run on a **Namespace.so remote builder** instead of the GitHub runner's
own docker daemon. Namespace gives more build CPU **and a persistent
cache that survives across runs** — a fresh GitHub runner has neither.

Measured on a real app (A-Guy), build step only:

| | GitHub runner | Namespace |
| --- | --- | --- |
| cold | ~7 min | ~4½ min |
| warm cache | ~7 min (never caches) | **~2½ min** |

→ **~2.4–2.7× faster**, and the gap widens as the cache warms.

### Enabling it — per repo, one switch

Add **`NSC_TENANT_ID`** (your Namespace tenant id, e.g.
`tenant_xxxxxxxx`) to the repo's **Kody vault** (`.kody/secrets.enc`,
via the `/secrets` page). That's it:

- **`NSC_TENANT_ID` present** → builds on Namespace.
- **`NSC_TENANT_ID` missing** → builds on the GitHub runner (default).

No kody.yml edit needed — the default template already grants
`id-token: write` (required for OIDC). It's **fail-open**: if Namespace
setup fails for any reason (outage, auth, missing trust), the build
silently falls back to the local docker build, so a preview is always
produced.

### Auth = OIDC federation (no static token)

Namespace is authenticated by **GitHub's OIDC identity**, not a stored
token (a static `nsc token create` token is *forbidden* from holding
build permissions). The workflow's `id-token: write` lets GitHub mint an
OIDC JWT; the engine exchanges it via `nsc auth exchange-oidc-token`.

For that exchange to be accepted, the Namespace tenant must **trust the
repo's GitHub OIDC issuer** — a one-time, operator-side step per GitHub
owner (covers every repo under it, so consumers stay zero-touch):

```bash
nsc auth trust-relationships add \
  --issuer "https://token.actions.githubusercontent.com" \
  --subject-match "repo:<owner>/*" \
  --audience "https://namespace.so" \
  --grant '{"resource_type":"*","resource_id":"*","actions":["*"]}'
```

> ⚠️ **Security:** the grant above is a full wildcard — any workflow in
> those repos can act as the tenant. It's the only grant that currently
> satisfies `nsc docker buildx setup` (`builder`/`compute`/`instance`
> scoped grants all get `VMService/GetProfile` PermissionDenied). Narrow
> it once Namespace support names the exact permission. The audience is
> arbitrary but must match on both sides (trust `--audience` + the
> engine's `getIDToken` audience).

### Scope + fallback

This only accelerates the **GitHub Actions** path. It can't help when
that path is unavailable — when the GitHub queue is full the router
offloads to the **Fly one-shot builder** (above), which has no GitHub
identity and so doesn't use Namespace. Build path precedence:

**Namespace** (if `NSC_TENANT_ID` set) → **GitHub local docker** (on
failure / unset) → **Fly builder** (if GitHub Actions is full/degraded).

- Engine code: `kody2/src/scripts/previewBuildNamespace.ts` (+ the build
  branch in `runPreviewBuild.ts`).

## Build mode (dev vs prod)

| Mode  | Image                            | First request        | Use case                                   |
| ----- | -------------------------------- | -------------------- | ------------------------------------------ |
| `prod` (default) | `default-Dockerfile.preview.prod` | Instant — already built | Most repos (matches Vercel) |
| `dev` | `default-Dockerfile.preview.dev`  | Slow — compiles in-machine | Tiny repos where build time > compile time |

Toggle per repo by adding `KODY_PREVIEW_BUILD_MODE=dev` to the repo's
vault. The dashboard reads it once at spawn time and passes
`PREVIEW_BUILD_MODE` into the builder. Heavy apps (e.g. anything with
Sentry + Genkit + Payload) **should stay on prod** — dev mode shifts
compile to a small preview machine and is slower end-to-end.

## Machine sizing

- **Builder Fly Machine**: shared-cpu-2x / 1 GB — orchestration only;
  the real `docker build` happens on `fly-builder-<org>` (Fly's
  always-on remote builder, performance-8x / 16 GB).
- **Preview Fly Machine**: shared-cpu-2x / 4 GB — needed for Next.js
  runtime memory headroom. Suspends when idle (≈$0).

## Static-file previews (upload-and-serve, no build)

A third preview kind, alongside PR and branch previews: upload a single
static file (HTML, PDF, image…) and host it as a live URL. **No builder,
no Docker build, no repo** — ready in seconds.

How it differs from the builder path: instead of spawning a builder that
clones + builds an image, the dashboard boots a stock static-server image
(`nginx:alpine`) and injects the uploaded file straight into the machine
via Fly's `config.files` (base64 `raw_value`). The only Fly calls are
`createApp → allocateSharedIps → createMachine`.

Where it lives: the **`/preview` page environment switcher**. Next to
"Add environment" there's an **Upload file** action — the uploaded file
becomes a selectable preview environment (its live Fly URL), shown in the
iframe like any other. Removing that environment also destroys its Fly app.

- HTML uploads are served as the site index. Any other type is served
  under its own name (so the right content-type is sent) with a tiny
  redirecting `index.html`.
- Single source of truth is the environment list in `.kody/dashboard.json`
  (`namedPreviews`); the uploaded entry carries a `staticId` so removal can
  tear the Fly app down, plus an `expiresAt`. No separate ledger.
- **Expiry: 7 days.** The dropdown shows days-left per upload and a Clock
  button to extend by another 7. There's no cron — the workspace reaps
  expired uploads (destroys the Fly app + drops the entry) on `/preview`
  load. Deleting the entry tears it down immediately; expiry is the
  backstop for ones nobody deletes.
- Per-repo billing as usual (the repo's vault `FLY_API_TOKEN`).
- Single file only, ≤ 5 MB (it's inlined into the machine config). For a
  multi-file site, use a branch preview.

| Where                          | What                                                  |
| ------------------------------ | ----------------------------------------------------- |
| `POST /api/kody/previews/static`   | Multipart upload (field `file`) → boots a preview, returns `{ id, url }` |
| `DELETE /api/kody/previews/static` | `{ id }` — destroy the Fly app (idempotent)       |
| `src/dashboard/lib/previews/static-preview.ts` | Builder-less create path        |
| `/preview` switcher "Upload file" | UI entry point (PreviewEnvSwitcher)                |

Image/web-root/port overridable via `KODY_PREVIEW_STATIC_IMAGE`,
`KODY_PREVIEW_STATIC_WEB_ROOT`, `KODY_PREVIEW_STATIC_PORT`.

## Dashboard surfaces

| Where                          | What                                                  |
| ------------------------------ | ----------------------------------------------------- |
| Task card "Preview" link       | Falls back to the deterministic Fly URL when Vercel hasn't published one yet |
| `GET /api/kody/previews/:o/:r/:pr` | Live status from Fly (state, machine id, region) |
| `DELETE /api/kody/previews/:o/:r/:pr` | Manual destroy (idempotent)                      |
| `app/api/webhooks/github/route.ts` | Auto-create on `pull_request.opened`/`synchronize`/`reopened`; destroy on `closed` |
| `/preview` switcher "Upload file" | Upload-and-serve static previews (see above)       |

## Code map

```
src/dashboard/lib/previews/
  preview-lifecycle.ts   createPreview / destroyPreview / getPreview
  builder-client.ts      Spawns the one-shot builder Fly Machine
  fly-previews.ts        Fly Machines REST + GraphQL client
  config.ts              Per-repo vault → FlyPreviewConfig
  webhook.ts             PR open/sync/closed handlers
  preview-key.ts         Deterministic app naming

builder/
  Dockerfile                       Alpine + node + flyctl + skopeo
  src/builder.ts                   One-shot CLI orchestrator
  src/fly-api.ts                   Minimal Fly REST + GraphQL client
  default-Dockerfile.preview.prod  Bundled template (default)
  default-Dockerfile.preview.dev   Bundled template (opt-in)
```

## Deploying the builder image

```bash
# From repo root (Kody-Dashboard)
flyctl deploy -c builder/fly.toml --app kody-preview-builder
```

The dashboard pulls `registry.fly.io/kody-preview-builder:latest` when
spawning a builder. Override with `KODY_PREVIEW_BUILDER_IMAGE` if
needed.

## Env vars (dashboard)

| Variable                       | Required | Purpose                                                   |
| ------------------------------ | -------- | --------------------------------------------------------- |
| `KODY_PREVIEW_BUILDER_IMAGE`   | No       | Override builder image (default: `registry.fly.io/kody-preview-builder:latest`) |
| `KODY_PREVIEW_BUILDER_HOST_APP`| No       | Fly app that hosts builder machines (default: `kody-preview-builder`) |
| `KODY_PREVIEW_GHCR_OWNER`      | No       | Enables GHCR base inheritance speed-up                    |
| `KODY_PREVIEW_STATIC_IMAGE`    | No       | Static-preview server image (default: `nginx:alpine`)     |
| `KODY_PREVIEW_STATIC_WEB_ROOT` | No       | Static-preview web root (default: `/usr/share/nginx/html`)|
| `KODY_PREVIEW_STATIC_PORT`     | No       | Static-preview internal port (default: `80`)              |

Per-repo vault keys:

| Key                        | Required | Purpose                                                |
| -------------------------- | -------- | ------------------------------------------------------ |
| `FLY_API_TOKEN`            | Yes      | Bills previews to this repo's Fly account              |
| `FLY_ORG_SLUG`             | Yes      | Fly org for the per-PR app                             |
| `FLY_DEFAULT_REGION`       | No       | Region hint (default: `iad`)                           |
| `KODY_PREVIEW_BUILD_MODE`  | No       | `dev` to opt into in-machine `next dev`                |
| *(other secrets)*          | No       | Forwarded to the build as `.env.production.local`      |

The `NEVER_PASS_TO_BUILD` set in `preview-lifecycle.ts` filters
infra-only keys (Fly token, master key, build-mode knob) so they don't
get baked into the image.

## Known limits / improvements not yet done

1. **Auto-rebuild the GHCR base on `main` push.** Today the base is
   manually rebuilt — stale base → PRs fall back to slow full installs.
   Fix is a workflow on the consumer repo that rebuilds + pushes on
   main merges. Highest-ROI remaining optimization.
2. **Skip rebuild when no code changed.** Hash the PR diff; if no
   meaningful files changed, reuse the previous image directly.
3. **Build artifact reuse across PRs of the same branch.** Today
   every push re-builds from scratch (modulo GHCR base inheritance).

## Testing

```bash
FLY_API_TOKEN=... pnpm vitest run tests/int/previews-builder-live.int.spec.ts
```

Auto-skips without `FLY_API_TOKEN`. Spawns a real builder machine
against a real repo + ref. Costs < $0.10/run.
