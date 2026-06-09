<!--
  @fileType module
  @domain runners
  @pattern runners-folder-readme
  @ai-summary Folder-level "start here" pointer for the Fly Machines +
    GitHub Actions runner layer. Three concerns under one roof:
    (1) Fly Machines spawn / claim / inventory / activity,
    (2) GitHub Actions health probe + dispatch decision,
    (3) per-machine activity persistence (Fly-only — GitHub cost lives
    elsewhere). Entry decision = `runner-router.ts`; orchestrator that
    wires the decision to the runners = `runner-dispatch.ts`. Load-bearing
    gotcha: `FLY_API_TOKEN` must come from the repo vault, never from
    `process.env` — see CLAUDE.md "PR previews on Fly Machines" and the
    "Environment Variables" section. Every file in this folder has its
    own `@ai-summary`; this README is the cross-cutting overview those
    headers do not give you on their own.
-->

# `runners/` — Fly Machines + GitHub Actions runner layer

This folder owns the decision of **where a kody job actually runs** —
GitHub Actions by default, a Fly Machine as the fallback — and the
per-feature Fly clients that back the fallback path. Read
[CLAUDE.md → PR previews on Fly Machines](../../../CLAUDE.md#pr-previews-on-fly-machines)
for the architecture overview; the files here are the load-bearing
implementation behind that section.

## Start here

- **`runner-router.ts`** — the **entry decision**: pure, side-effect-free
  function that returns `{ runner: "github" | "fly", reason }` from a
  GitHub Actions health probe + a "Fly configured?" flag. Exhaustive
  branch coverage, no I/O, easy to unit-test.
- **`runner-dispatch.ts`** — the **orchestrator**: calls
  `chooseRunner` from `runner-router`, then _executes_ it
  (`dispatchGitHub` or `runFly`). All side effects are injected
  (`checkHealth`, `dispatchGitHub`, `runFly`) so the decision + execute
  flow is testable without a network. Handles the two fallback cases:
  **PROACTIVE** (GitHub unhealthy before we try) and **REACTIVE**
  (the dispatch call itself throws).
- **`fly.ts`** — the **per-feature Fly clients** live behind this one
  entry: `spawnRunner` (one-shot machines for `kody-live-fly` sessions,
  `auto_destroy=true`, `restart=no`). The other `fly*.ts` files are
  specialised spawners / probes for individual Fly surfaces (see
  [Folder layout](#folder-layout) below).

Everything else in the folder is either a sibling Fly client, the
GitHub health probe, or the per-machine activity pipeline. If you are
adding a new Fly surface, follow the same pattern: thin client,
`@ai-summary` header, and a single exported entry function.

## Folder layout

| File                    | Concern                | One-liner                                                                |
| ----------------------- | ---------------------- | ------------------------------------------------------------------------ |
| `runner-router.ts`      | GitHub Actions routing | Pure decision: github vs fly.                                            |
| `runner-dispatch.ts`    | GitHub Actions routing | Orchestrator: probe + choose + execute.                                  |
| `github-health.ts`      | GitHub Actions routing | Health probe: status page + queue depth. Fails open.                     |
| `fly.ts`                | Fly Machines           | One-shot `spawnRunner` for kody-live sessions.                           |
| `fly-context.ts`        | Fly Machines           | Resolves Fly spawn context from headers + vault.                         |
| `fly-run.ts`            | Fly Machines           | Claim warm pool, else fall through to `spawnRunner`.                     |
| `pool-client.ts`        | Fly Machines           | Warm pool claim — never throws, falls back to fresh spawn.               |
| `pool-keys.ts`          | Fly Machines           | Derives the pool API key from `KODY_MASTER_KEY` (HKDF).                  |
| `fly-inventory.ts`      | Fly Machines           | Read-only inventory of all kody-managed Fly machines.                    |
| `fly-suspend-all.ts`    | Fly Machines           | Bounded-concurrency "Suspend all" batch helper.                          |
| `brain-fly.ts`          | Fly Machines           | Persistent per-user Brain app provisioner (long-lived, not one-shot).    |
| `litellm-fly.ts`        | Fly Machines           | Read-only status probe for the shared LiteLLM proxy.                     |
| `fly-rates.ts`          | Fly Machines           | Approximate hourly cost from Fly's published rates.                      |
| `fly-activity.ts`       | Activity persistence   | Pure compute: uptime %, running ms, est cost from snapshots.             |
| `fly-activity-store.ts` | Activity persistence   | Persists snapshots to `.kody/state/fly-activity.json` (CAS + throttled). |

## How the pieces fit together

```
   route (e.g. POST /api/kody/fly/start)
        │
        ▼
   resolveFlyContext        (fly-context.ts: vault + headers → FlyContext)
        │                       reads FLY_API_TOKEN from the per-repo vault
        ▼
   dispatchRun              (runner-dispatch.ts: orchestrator)
        │      │
        │      ├─ checkGitHubActionsHealth (github-health.ts)
        │      │       └─ status page + workflow queue depth
        │      ▼
        │   chooseRunner                    (runner-router.ts: pure)
        │      │
        │      └─ "github" → dispatchGitHub (workflow_dispatch API)
        │      └─ "fly"    → runFly
        │                      │
        │                      ▼
        │                  claimFromPool   (pool-client.ts: ~1s)
        │                      │ miss
        │                      ▼
        │                  spawnRunner     (fly.ts: ~3min cold)
        │
        ▼
   session meta written to .kody/state/sessions.jsonl
   events stream back via /api/kody/events/ingest
```

The activity pipeline (`fly-activity.ts` + `fly-activity-store.ts`) is
**read-only** relative to dispatch — the inventory route calls it
periodically to build the Fly machines dashboard, with throttled writes
back to the kody-state branch.

## Load-bearing gotchas

These are the rules that are easy to break and hard to debug when you
do. They come from CLAUDE.md and from prior production incidents.

1. **`FLY_API_TOKEN` must come from the repo vault, never from
   `process.env`.** It is a **per-repo credential**, owned by the
   authenticated user, not by Vercel. Server code resolves it via
   `resolveFlyContext` → `readVault` → `doc.secrets.FLY_API_TOKEN`. Do
   **not** add `FLY_API_TOKEN` (or `FLY_IO_TOKEN`) as a Vercel env
   var. The Settings page → Fly Runner card stores the **performance
   tier** only (`x-kody-fly-perf` header); the token lives in
   `/secrets`. See [CLAUDE.md → Environment Variables](../../../CLAUDE.md#environment-variables)
   and [CLAUDE.md → Secrets vault (`/secrets`)](../../../CLAUDE.md#secrets-vault-secrets).

2. **`account` ≠ `owner`.** `FlyContext.account` is the verified PAT
   owner (stable per person); `owner` is the connected repo's owner
   (incidental — changes when the user switches repos). Key per-user
   infra (the Brain app name) on `account`, not `owner`.

3. **The warm pool is an accelerator, not a dependency.**
   `claimFromPool` **never throws** — it returns `{ ok: false }` on
   any failure and the caller falls through to a fresh
   `spawnRunner`. GitHub Actions remains the ultimate fallback. If
   you add a new path that goes through the pool, do not add a
   throw — preserve the contract.

4. **GitHub Actions health fails open.** A status-page hiccup or a
   transient list error must never wrongly divert every job to Fly
   (which would burn the user's Fly budget for no reason). Both
   probes in `github-health.ts` are explicitly fail-open.

5. **One-shot vs persistent Fly surfaces are not interchangeable.**
   `fly.ts` is `auto_destroy=true`, `restart=no` — wrong shape for a
   long-running server. `brain-fly.ts` is the persistent variant
   (`autostop="suspend"` for near-zero idle). Do not copy patterns
   across the two without re-reading the headers.

## Extending the folder

- **New Fly surface (e.g. a new per-feature proxy)?** Mirror
  `litellm-fly.ts`: thin client, `@ai-summary` header, derive the
  app name from a single constant, return a typed result with a
  discriminated status. Use `flyFetch` from `brain-fly.ts` for the
  HTTP layer so auth + base URL stay consistent.
- **New runner choice dimension?** Add a new flag to
  `RouteDecision` _and_ an injected dep in `DispatchDeps` — the
  router stays pure, the dispatcher stays the only place with
  side effects.
- **New activity metric?** Add it to `ActivitySample` /
  `ActivitySnapshot` and compute it in `fly-activity.ts` (pure,
  unit-testable). The store only persists — it never derives.
