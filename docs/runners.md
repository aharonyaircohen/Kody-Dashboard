# Where a run executes

Every Kody run lands on one of two runtimes, and the dashboard picks for
you. **GitHub Actions is the base** — it's the default, it's free on public
repos, and it works with zero extra setup. **Fly Machines is the
fallback/opt-in** — the dashboard auto-diverts a run to Fly only when
GitHub Actions can't take it, and only if that repo has a Fly token. With no
Fly token configured, every run stays on GitHub, end of story.

The whole design is **fail-open**: if the routing decision can't be made, or
the Fly side errors, the run falls back to GitHub. The only way to get
"nowhere to run" is for GitHub itself to reject the dispatch _and_ have no
Fly token to fall back on — at which point the error is surfaced honestly
rather than silently swallowed. This auto-routing was proven live during a
real GitHub Actions outage.

Every Fly feature — runners, warm pool, the Brain, the LiteLLM proxy —
gates on the **per-repo** vault secret `FLY_API_TOKEN`. There is no global
Fly pool: each connected repo runs on its own Fly token, pulled from that
repo's encrypted vault (see [./secrets-vault.md](./secrets-vault.md)). The
shared LiteLLM proxy is the _only_ cross-repo Fly exception.

## The pieces

| Piece                  | What it is                                                                                                                                                  | Where                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `chooseRunner`         | Pure decision: GitHub if healthy; Fly only if GitHub is unhealthy **and** a Fly token exists; otherwise stay on GitHub. No I/O — exhaustively unit-testable. | [`../src/dashboard/lib/runners/runner-router.ts`](../src/dashboard/lib/runners/runner-router.ts)                   |
| `dispatchRun`          | Orchestrator. Probes health, calls `chooseRunner`, then dispatches. Falls back to Fly **proactively** (GitHub unhealthy) and **reactively** (dispatch threw). | [`../src/dashboard/lib/runners/runner-dispatch.ts`](../src/dashboard/lib/runners/runner-dispatch.ts)               |
| `checkGitHubActionsHealth` | Live health probe: GitHub's status page lists Actions as operational **and** the `kody.yml` queue isn't backed up past a threshold. Both probes fail open. | [`../src/dashboard/lib/runners/github-health.ts`](../src/dashboard/lib/runners/github-health.ts)                   |
| `claimOrSpawnFly`      | The Fly execution core: claim a warm-pool machine (~1s wake), else spawn a fresh one (~3min). Shared by the fallback and the dedicated Fly route so they can't drift. | [`../src/dashboard/lib/runners/fly-run.ts`](../src/dashboard/lib/runners/fly-run.ts)                               |
| `resolveFlyContext`    | Builds the Fly spawn context: auth, repo, the decrypted secrets vault, the per-repo `FLY_API_TOKEN`, perf tier, LiteLLM URL. `flyAvailable` is just "did this return a token."  | [`../src/dashboard/lib/runners/fly-context.ts`](../src/dashboard/lib/runners/fly-context.ts)                       |
| Warm pool client       | Claims a pre-booted, frozen Fly machine from the always-on pool owner. **Never throws** — any miss returns `ok:false` and the caller spawns fresh. Pools are per-repo. | [`../src/dashboard/lib/runners/pool-client.ts`](../src/dashboard/lib/runners/pool-client.ts)                       |
| `spawnRunner`          | Thin Fly Machines API client — creates a one-shot machine that runs the engine image once and auto-destroys. VM shape comes from the perf tier.             | [`../src/dashboard/lib/runners/fly.ts`](../src/dashboard/lib/runners/fly.ts)                                       |
| `/runner` page         | **Per-repo** Fly config: token status, warm-pool size, LiteLLM proxy, Brain-on-Fly — plus a per-browser perf tier.                                          | [`../app/(chat-rail)/runner/page.tsx`](<../app/(chat-rail)/runner/page.tsx>)                                       |

## The routing decision

`chooseRunner` is a three-line truth table, deliberately side-effect-free so
the live probe and the token lookup happen in the caller and the decision
itself is exhaustively unit-tested:

| GitHub Actions healthy? | Fly token present? | Runner                      | Why                                                       |
| ----------------------- | ------------------ | --------------------------- | --------------------------------------------------------- |
| yes                     | (irrelevant)       | **github** (base)           | GitHub is the default; never divert a healthy base.       |
| no                      | yes                | **fly** (proactive fallback)| Status degraded or queue full — send it somewhere it'll run. |
| no                      | no                 | **github**                  | Nowhere else to send it — stay on GitHub even if unhealthy. |

"Healthy" is two signals combined by `checkGitHubActionsHealth`, **both
failing open** so a status-page hiccup or a single list-call error never
wrongly diverts every job to Fly:

1. **Status** — GitHub's public status page (`githubstatus.com`) lists the
   "Actions" component as `operational`. Cached 30s, shared across requests,
   so we don't hammer the status endpoint on every dispatch. A fetch/parse
   error assumes operational.
2. **Queue** — the count of `queued` `kody.yml` runs is below
   `DEFAULT_QUEUE_THRESHOLD` (10). A failed count is treated as 0 (not full),
   leaving the status probe as the authority on outages.

## Dispatch + fallback flow

```
                        ┌──────────────────────────────────────────┐
   POST /interactive/   │ resolveFlyContext → flyAvailable?          │
   start (a run)        │   (true only if this repo's vault has      │
        │               │    FLY_API_TOKEN)                          │
        ▼               └────────────────────┬───────────────────────┘
   ┌──────────────┐                          │
   │ dispatchRun  │◀─────────────────────────┘
   └──────┬───────┘
          │ checkGitHubActionsHealth (status page + kody.yml queue)
          ▼
   ┌──────────────────┐
   │ chooseRunner     │
   └───┬──────────┬───┘
       │ github   │ fly  (PROACTIVE: GitHub unhealthy + token present)
       ▼          └──────────────────────────────┐
 ┌──────────────────────────┐                     ▼
 │ createWorkflowDispatch    │            ┌──────────────────────┐
 │   (kody.yml, ref: main)   │            │ claimOrSpawnFly       │
 └──────┬────────────────────┘            │  warm pool (~1s)      │
        │ throws?                          │   else spawn (~3min)  │
        │  ├─ no  → runner: github         └──────────┬───────────┘
        │  └─ yes ─────────────────────────────────────┤ REACTIVE fallback
        │         (only if flyAvailable; else rethrow)  ▼
        │                                    runner: fly (fellBackOnError)
        ▼
   runner: github
```

The route's response carries `runner` (`"github"` | `"fly"` | `"pool"`) and a
human-readable `reason`, so the UI and logs always show where a run landed
and why. `fellBackOnError: true` flags the reactive case (GitHub dispatch
threw, Fly caught it).

This flow is wired into
[`../app/api/kody/chat/interactive/start/route.ts`](../app/api/kody/chat/interactive/start/route.ts).
There's also a dedicated **always-Fly** route,
[`../app/api/kody/chat/interactive/start-fly/route.ts`](../app/api/kody/chat/interactive/start-fly/route.ts)
(the `kody-live-fly` agent), which skips the health probe entirely and goes
straight to `claimOrSpawnFly` — it requires a Fly token and errors if there
isn't one, because the user explicitly asked for Fly.

## What runs on Fly, and why per-repo

`claimOrSpawnFly` first asks the **warm pool** for a machine. The pool owner
keeps `POOL_MIN` machines pre-booted and frozen per repo, so a claim wakes
one in ~1s instead of a ~3min cold start. A pool miss (empty, unreachable,
unconfigured) never throws — `claimFromPool` returns `ok:false` and
`claimOrSpawnFly` falls through to `spawnRunner`, which creates a fresh
one-shot Fly Machine that runs the engine image and auto-destroys.

Everything here is **keyed per repo by that repo's `FLY_API_TOKEN`**:

- The token is a **project credential**, stored only in the per-repo vault
  (`.kody/secrets.enc`), surfaced by `resolveFlyContext` as `flyToken` and
  stripped out of the secrets blob the engine sees. It is **not** a Vercel
  env var and there is **no** `x-kody-fly-token` header.
- The warm pool is per-repo: the pool owner resolves each repo's Fly token
  and provider keys from that repo's vault, so secrets reach the runner via
  the vault, never over the wire.
- The **only** cross-repo exception is the shared **LiteLLM proxy** — one
  always-on Fly app (`kody-litellm`) that every repo's runner forwards to
  over the private 6PN network, reused so each session skips its own ~24s
  proxy startup.

## The `/runner` page

`/runner` is **per-repo** config — it changes behavior for everyone working
on the connected repo. It is deliberately separate from `/settings`, which
is **per-user** (per-browser) only; the home of a control is decided by its
blast radius, not by where it's stored. The page splits its cards into two
labeled groups:

| Group           | Card                  | What it does                                                                                                  | Storage                                          |
| --------------- | --------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Repo-wide**   | Fly Machines token    | Read-only "configured / not set" probe of the `FLY_API_TOKEN` vault secret. The token is set on `/secrets`.   | vault `FLY_API_TOKEN` (per repo)                 |
| **Repo-wide**   | Warm pool size        | How many machines to keep pre-booted (`POOL_MIN`, default 2, max 10; 0 = always cold-start).                  | vault `POOL_MIN` (per repo)                      |
| **Repo-wide**   | LiteLLM proxy         | Read-only status of the shared always-on proxy.                                                               | —                                                |
| **Repo-wide**   | Brain on Fly          | Toggle the Fly-hosted chat Brain.                                                                             | vault (per repo)                                 |
| **Your sessions** | Performance tier    | VM shape (low / medium / high) for the Fly runs **this browser** starts. Sent as the `x-kody-fly-perf` header. | `localStorage.kody_auth.flyPerf` (per browser)   |

The performance tier is the lone per-user knob on this page: it rides along
on start-fly calls as `x-kody-fly-perf`, which `resolveFlyContext` reads and
maps to a fixed Fly guest config (`PERF_GUEST` in `fly.ts`). It is **not**
stored in the vault — it's a browser-local preference, so two operators on
the same repo can pick different VM sizes without stepping on each other.

> The Settings page references `/runner` only as a quick link. Despite older
> notes describing a "Settings → Fly Runner card" that owned `flyPerf`, the
> perf tier and the token probe now live on `/runner`; nothing Fly-related is
> configured on `/settings` anymore.

## File reference

| File                                                                                                | Purpose                                                            |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`../src/dashboard/lib/runners/runner-router.ts`](../src/dashboard/lib/runners/runner-router.ts)     | Pure runner decision (`chooseRunner`)                             |
| [`../src/dashboard/lib/runners/runner-dispatch.ts`](../src/dashboard/lib/runners/runner-dispatch.ts) | Decide + execute orchestrator (`dispatchRun`)                    |
| [`../src/dashboard/lib/runners/github-health.ts`](../src/dashboard/lib/runners/github-health.ts)     | GitHub Actions health probe (status + queue, fail-open)           |
| [`../src/dashboard/lib/runners/fly-run.ts`](../src/dashboard/lib/runners/fly-run.ts)                 | Claim-warm-pool-else-spawn Fly core (`claimOrSpawnFly`)          |
| [`../src/dashboard/lib/runners/fly-context.ts`](../src/dashboard/lib/runners/fly-context.ts)         | Fly spawn context: auth, vault, token, perf tier                  |
| [`../src/dashboard/lib/runners/fly.ts`](../src/dashboard/lib/runners/fly.ts)                         | Fly Machines API client (`spawnRunner`, `PERF_GUEST`)            |
| [`../src/dashboard/lib/runners/pool-client.ts`](../src/dashboard/lib/runners/pool-client.ts)         | Warm-pool claim + per-repo status (never throws)                  |
| [`../src/dashboard/lib/runners/pool-keys.ts`](../src/dashboard/lib/runners/pool-keys.ts)             | Derives the pool API key from `KODY_MASTER_KEY` (HKDF)            |
| [`../app/api/kody/chat/interactive/start/route.ts`](../app/api/kody/chat/interactive/start/route.ts) | Run-start route that wires `dispatchRun` (GitHub base + fallback) |
| [`../app/api/kody/chat/interactive/start-fly/route.ts`](../app/api/kody/chat/interactive/start-fly/route.ts) | Always-Fly run-start route (`kody-live-fly`)              |
| [`../app/(chat-rail)/runner/page.tsx`](<../app/(chat-rail)/runner/page.tsx>)                          | `/runner` page entry point                                       |
| [`../src/dashboard/lib/components/RunnerManager.tsx`](../src/dashboard/lib/components/RunnerManager.tsx) | `/runner` UI (token probe, pool size, perf tier, cards)      |

## FAQ

**Do I have to set anything up to run on GitHub Actions?**

No. GitHub Actions is the base runner and works with zero Fly config —
`dispatchRun` dispatches `kody.yml` on `ref: main` and that's the whole path.
Fly is purely additive.

**When does a run actually go to Fly?**

Only when GitHub Actions can't take it **and** the repo has a `FLY_API_TOKEN`.
Two triggers: **proactive** — the status page reports Actions as
degraded/down or the `kody.yml` queue is past the threshold (10) before we
even dispatch; **reactive** — the GitHub dispatch call itself throws (the 500
seen during a real outage). Without a Fly token, both cases stay on GitHub.

**What happens if Fly routing itself fails?**

It fails open to GitHub. Context resolution is wrapped so a failure just sets
`flyAvailable: false`. The single genuine error path is GitHub dispatch
throwing _and_ no Fly token — there's truly nowhere to run, so the route
returns 500 instead of pretending the run started.

**Is there one shared Fly pool for all repos?**

No. Every repo runs on its own `FLY_API_TOKEN` from its own vault, and warm
pools are per-repo. The shared LiteLLM proxy is the single cross-repo Fly
resource.

**Why is warm-pool size on `/runner` but the perf tier feels per-user?**

Blast radius. Pool size (`POOL_MIN`) changes behavior for everyone on the
repo, so it's a repo-wide vault secret on `/runner`. The perf tier only sizes
_your_ browser's Fly runs, so it's a per-browser localStorage preference —
same page, different group, by design (see
[[feedback_settings_per_user_only]]).

**Are scheduled duties auto-routed to Fly too?**

Not yet. Auto-routing currently covers interactively started runs. Scheduled
duties still fire from GitHub's own cron, so a GitHub Actions outage can still
delay them — closing that gap (a dashboard-owned tick) is the v2 follow-up.
