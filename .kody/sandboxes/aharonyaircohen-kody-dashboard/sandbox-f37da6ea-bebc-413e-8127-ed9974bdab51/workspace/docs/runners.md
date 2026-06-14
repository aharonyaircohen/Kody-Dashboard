# Where a run executes

Every Kody run lands on one of two runtimes:

- **GitHub Actions** is the base runner. It works with no Fly setup.
- **Fly Machines** is the fallback or explicit opt-in. It is used only when
  the repo has `FLY_API_TOKEN` in the vault.

There is no shared LiteLLM Fly service. Fly runs still try the warm pool
first, then spawn a fresh machine if the pool misses. Each runner machine uses
the runner image's own local model-proxy startup path.

## The Pieces

| Piece                      | What it does                                                                                                                    | Where                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `chooseRunner`             | Pure decision: GitHub if healthy; Fly only if GitHub is unhealthy and a Fly token exists.                                       | [`../src/dashboard/lib/runners/runner-router.ts`](../src/dashboard/lib/runners/runner-router.ts)     |
| `dispatchRun`              | Probes health, calls `chooseRunner`, dispatches GitHub, and falls back to Fly if GitHub dispatch throws.                        | [`../src/dashboard/lib/runners/runner-dispatch.ts`](../src/dashboard/lib/runners/runner-dispatch.ts) |
| `checkGitHubActionsHealth` | Checks GitHub Actions status and the `kody.yml` queue. Both probes fail open.                                                   | [`../src/dashboard/lib/runners/github-health.ts`](../src/dashboard/lib/runners/github-health.ts)     |
| `resolveFlyContext`        | Builds the Fly spawn context: auth, repo, vault secrets, per-repo `FLY_API_TOKEN`, and perf tier.                               | [`../src/dashboard/lib/runners/fly-context.ts`](../src/dashboard/lib/runners/fly-context.ts)         |
| `claimOrSpawnFly`          | Shared Fly path for the fallback route and the dedicated Fly route. Claims pool first, then fresh-spawns on miss.                | [`../src/dashboard/lib/runners/fly-run.ts`](../src/dashboard/lib/runners/fly-run.ts)                 |
| `claimFromPool`            | Claims a pre-warmed runner from the configured pool owner. Never throws; misses fall back to fresh spawn.                       | [`../src/dashboard/lib/runners/pool-client.ts`](../src/dashboard/lib/runners/pool-client.ts)         |
| `spawnRunner`              | Thin Fly Machines API client. Creates a one-shot machine that runs the engine image and auto-destroys.                          | [`../src/dashboard/lib/runners/fly.ts`](../src/dashboard/lib/runners/fly.ts)                         |
| `/runner` page             | Per-repo Fly token status, live machine inventory, activity, previews, Brain-on-Fly, and this browser's Fly performance setting. | [`../app/(chat-rail)/runner/page.tsx`](<../app/(chat-rail)/runner/page.tsx>)                         |

## Routing

| GitHub Actions healthy? | Fly token present? | Runner             |
| ----------------------- | ------------------ | ------------------ |
| yes                     | any                | GitHub Actions     |
| no                      | yes                | Fly Machines       |
| no                      | no                 | GitHub Actions     |

If GitHub dispatch itself throws and Fly is available, the route falls back
to Fly. If GitHub throws and Fly is not available, the error is surfaced.

## Fly Rules

- Fly credentials are per repo: `FLY_API_TOKEN` lives in that repo's vault.
- The dashboard does not use a global Fly token for runner work.
- Fly runners claim the warm pool first, then spawn fresh on miss.
- `FLY_POOL_URL` points at the pool owner. There is no implicit shared
  LiteLLM pool endpoint.
- The dashboard does not pass a shared LiteLLM URL to runners or Brain.
- VM size comes from this browser's perf tier and is sent as
  `x-kody-fly-perf`.

## Routes

[`../app/api/kody/chat/interactive/start/route.ts`](../app/api/kody/chat/interactive/start/route.ts)
uses GitHub first and Fly as fallback.

[`../app/api/kody/chat/interactive/start-fly/route.ts`](../app/api/kody/chat/interactive/start-fly/route.ts)
is the explicit Fly route used by `kody-live-fly`; it requires a Fly token.
