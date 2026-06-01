# Merge conflict resolution for PR #31

## What happened
PR #31 (fix browser tab title duplication) was merged into main, then a merge from origin/main into the PR branch produced conflicts in three files.

## Resolution
Took origin/main side for all three conflicts:

1. **TrustManager.tsx** — HEAD had old "staff member" + CTO_GRADUATION_THRESHOLD text; origin/main had "duty" + TRUST_GRADUATION_THRESHOLD (refactored terminology). Took origin/main.

2. **useTrust.ts** — HEAD imported from `./decisions` and `./trust-ops`; origin/main imports from `./trust-state`. The trust-ops.ts file no longer exists in the current codebase (merged into trust-state.ts). Took origin/main.

3. **cto-trust-ops.spec.ts** — origin/main deleted this file as part of the architecture refactor. HEAD still had it with imports from non-existent trust-ops. Accepted deletion.

## Quality checks
- `pnpm typecheck` — passed
- `pnpm lint` — passed (pre-existing warnings only)
- `pnpm build` — passed

## Follow-up
The deleted test file should be rewritten against the new trust-state API if test coverage is desired for the trust management ops.
