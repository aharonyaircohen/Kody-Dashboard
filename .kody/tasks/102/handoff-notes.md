# Issue #102 — Goals engine dispatch passes no goal context

## What was done

**`app/api/kody/goals/[id]/manage/route.ts`**: Added `inputs: { issue_number: { value: id } }` to the `createWorkflowDispatch` call at line 241. This passes the goal slug (e.g. `duty-migration`) to `kody.yml` as the `issue_number` workflow input, giving the engine goal context when it runs.

**`tests/unit/goal-manage-route.spec.ts`**: Updated the first test to capture and assert the `createWorkflowDispatch` call arguments, verifying that `inputs.issue_number.value` equals the goal id.

## What is NOT done (out of scope for this repo)

The engine (`@kody-ade/kody-engine` — external npm package) must be updated to detect when `github.event.inputs.issue_number` is a goal slug (i.e., when `.kody/goals/<issue_number>/` exists) and read from `.kody/goals/<slug>/state.json` on `kody-state` instead of treating it as a GitHub issue number. This follow-up is tracked in `followups.json`.

## Verification

- `pnpm test -- tests/unit/goal-manage-route.spec.ts` — 3 tests pass
- `pnpm typecheck` — passes
- `pnpm lint` — passes (warnings only, pre-existing)
- `pnpm format` — ran to fix pre-existing format issues in unrelated files; `pnpm format:check` now passes
