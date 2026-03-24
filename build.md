# Build Agent Report: KodyEngineContract

## Summary

Implemented the Engine Contract feature — a convention-based interface between the dashboard and any CI/CD engine (GitHub-only). The implementation defines how the dashboard instructs engines (Actions) and how engines report state back (State).

## Changes

### New Files Created

**Contracts (`src/dashboard/contracts/`):**

- `actions.ts` — `EngineAction` type + Zod schema + state machine (`isValidAction`, `getValidActions`, `getInvalidActions`) + comment parsing (`parseActionFromComment`, `parseWorkflowDispatch`) + display helpers (`describeAction`, `formatActionAsComment`)
- `state.ts` — `PipelineStatus` interface + Zod schema with `.passthrough()` + comment parser (`buildStatusCommentMarker`, `parseStatusCommentMarker`, `extractPipelineData`, `buildStatusComment`, `findStatusCommentId`, `parseAndValidatePipelineStatus`) + label mapping (`isEngineLabel`, `getStateFromLabel`, `buildLabel`, `stateToKanbanColumn`) + ETag polling helpers (`getETag`, `buildPollingHeaders`, `isNotModifiedResponse`, `getCommentUpdateStrategy`)
- `kody.ts` — `KodyPipelineStatus` extension + Zod schema + `ActorEvent` schema + PR review trigger adapter (`translatePRReviewToAction`) + backward compat validator (`validateKodyStatusBackwardCompat`) + Kody label helpers (`isKodyLabel`, `getKodyStateFromLabel`)
- `index.ts` — barrel export for all contracts

**Tests (`tests/int/`):**

- `engine-contract-actions.int.spec.ts` — 61 tests covering EngineAction schema validation, state machine, comment parsing, workflow_dispatch parsing, display helpers
- `engine-contract-state.int.spec.ts` — 67 tests covering PipelineStatus schema, label parsing, status comment parsing, ETag polling, Kody extensions, PR review trigger

**Config:**

- `vitest.config.ts` — Vitest configuration with `@dashboard/*` path alias

## Delegation Results

No delegation — single territory (dashboard contracts only).

## Tests Written

- `tests/int/engine-contract-actions.int.spec.ts` — 61 tests
- `tests/int/engine-contract-state.int.spec.ts` — 67 tests

**Total: 128 tests passing**

## Deviations

- **types.ts not modified**: Phase 3 of the implementation plan suggested updating `src/dashboard/lib/types.ts` to import from contracts. The existing `KodyPipelineStatus` in types.ts has schema differences from the contract types (e.g., `controlMode` variants differ). Modifying types.ts risks breaking existing code that depends on the original shapes. The contract types are available for new code to use via imports from `@dashboard/contracts`.

- **ESLint config missing**: The `pnpm lint` command fails because there's no `eslint.config.js` file. This is a **pre-existing issue** in the project — lint fails even without any contract-related changes.

## Quality

- TypeScript: **PASS** (`pnpm typecheck`)
- Lint: **FAIL (pre-existing issue — no ESLint config)**
- Tests: **PASS** (128/128 tests passing)

## Contract Summary

### Contract 1: Actions (Dashboard → Engine)

```typescript
type EngineAction =
  | { action: "run"; command: string }
  | { action: "approve" }
  | { action: "reject" }
  | { action: "rerun"; fromStage?: string; feedback?: string }
  | { action: "abort" };
```

State machine validates action+state combinations:

| State     | Valid actions          |
| --------- | ---------------------- |
| (none)    | run                    |
| running   | abort                  |
| paused    | approve, reject, abort |
| failed    | rerun, run             |
| timeout   | rerun, run             |
| completed | rerun, run             |

### Contract 2: State (Engine → Dashboard)

- **Labels**: `{engine}:{suffix}` format (building → running, done → completed, failed → failed, paused → paused, timeout → timeout)
- **Status Comment**: `<!-- {engine}-status:{taskId} -->` marker + `<!--pipeline-data\n{json}\n-->` JSON block
- **ETag polling**: 304 Not Modified responses for efficient polling (no rate limit consumption)

### Kody Extension

- `KodyPipelineStatus` extends `PipelineStatus` with cost tracking, token usage, actor history, control mode
- `KodyStageStatus` extends `StageStatus` with cost, tokenUsage, feedbackLoops, fixAttempt
- `translatePRReviewToAction()` converts PR `changes_requested` reviews to `{ action: 'rerun', feedback }`
- Backward compatible — existing Kody engine output passes both generic and Kody Zod schemas

## Test Coverage

All 128 tests pass covering:

- EngineAction schema validation (run, approve, reject, rerun, abort)
- State machine validation (isValidAction, getValidActions, getInvalidActions)
- Comment parsing (@{engine} {action} format)
- Workflow dispatch parsing
- Label mapping (isEngineLabel, getStateFromLabel, buildLabel)
- Kanban column mapping (stateToKanbanColumn)
- Status comment parsing and building
- Comment discovery and caching (findStatusCommentId)
- ETag polling helpers
- KodyPipelineStatus and KodyStageStatus schemas
- PR review trigger adapter
- Backward compatibility validator
