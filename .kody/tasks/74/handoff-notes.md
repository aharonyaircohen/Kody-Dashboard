Per-section "Suspend all" button on the Runner page Machines tab.

**What changed**

- `src/dashboard/lib/runners/fly-suspend-all.ts` (new): pure batch helper
  `batchSuspendRunning(rows, suspendOne, concurrency=6)`. Filters by
  `isRunningState` (skips suspended/stopped/destroyed), runs the injected
  `suspendOne` per row in parallel with bounded concurrency via an
  in-file `mapLimit`, captures per-row success/failure in a `SuspendResult`
  list, and returns `{ results, okCount, failCount }` for partial-success
  toasting. `countRunningInGroup` is exported separately so the UI can
  decide whether to show the button at all.
- `src/dashboard/lib/components/FlyMachinesTable.tsx`: added a "Suspend
  all" button next to the existing count in every feature-group header
  (Previews / Runners / Brain / LiteLLM / Builders / Preview base / Other).
  Hidden when `countRunningInGroup === 0`. On click, opens a confirm
  dialog naming the section and the running count; on confirm, calls
  `batchSuspendRunning` with an inline fetcher that hits the existing
  `POST /api/kody/fly/machines/action` endpoint. While in flight, the
  header button shows a spinner and per-row actions in the same group
  are disabled (the existing `busy` flag now OR'd with `groupBusy`).
  Partial-failure toasts list the failed machine IDs; success refreshes
  the inventory via the existing `refresh()` flow. The per-row
  `ConfirmDialog` state and the new group `ConfirmDialog` state are
  namespaced (`confirm` vs `confirmFeature`) to avoid collision.
- `tests/unit/fly-suspend-all.spec.ts` (new): 7 unit tests covering state
  classification, group count, the skip-suspended guarantee, bounded
  concurrency (peak ≤ limit), per-row failure capture without aborting
  the rest, and the empty-group no-op.

**Verification**: `pnpm typecheck`, `pnpm test` (1202 green), `pnpm lint`,
`pnpm format:check`, and `verify` (ok=true) all pass.

**No backend changes** — reuses `POST /api/kody/fly/machines/action`.
**No new deps**.
