# Task 159 — docs-coverage: src/dashboard/lib/runners/

## What I did

Issue 159 said the runners/ folder has 15 modules, all already carrying `@ai-summary` headers, but lacked a central file or top-level "start here" — so a newcomer reading the folder cold had to grep across files to learn the seam (entry point, GitHub→Fly fallback contract, warm-pool boundary).

I added a folder-level "start here" header to `src/dashboard/lib/runners/runner-router.ts` — the smallest, purest module at the heart of the seam. The header covers:

- **What this folder is** — GitHub↔Fly runner decision + Fly execution path
- **Entry points** — `dispatchRun` (route-side) and `claimOrSpawnFly` (warm-pool-or-spawn)
- **GitHub→Fly fallback contract** — the 5-step decision (probe → healthy? → token? → rethrow?)
- **Warm-pool boundary** — accelerator not hard dependency; derived key, never stored
- **Fly token plumbing** — single `resolveFlyContext` entry; per-repo billing
- **Operator UI surface** — inventory/activity/cost modules, no routing

The second bullet of the issue ("add @ai-summary to modules that lack one") was a no-op — all 15 modules already had one (verified via `grep '@ai-summary' src/dashboard/lib/runners/*.ts`).

## Verification

- `pnpm typecheck` — clean
- `pnpm lint` — 0 errors (124 unrelated warnings)
- `pnpm test --run tests/unit/runners/` — 72/72 pass
- `pnpm prettier --check src/dashboard/lib/runners/**/*.ts` — clean
- `mcp__kody-verify__verify` — failed only on 2 pre-existing prettier issues in `app/api/kody/docs/route.ts` and `tests/unit/auth-me.spec.ts`, both untouched by this task (last touched in commits c3c90788 / 44cddc73)

## What I did NOT do

- No code changes — pure doc-comment.
- No new test — no behavior change to test.
- Did not create a new `index.ts` barrel — the issue said "add a folder-level header to a central file", not "create a new barrel", and no other folder in the repo uses a barrel for flat-module layouts like runners/ (the existing barrels like `branches/index.ts` are for layered subfolders).
