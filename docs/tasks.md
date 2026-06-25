# Tasks board

The dashboard renders every Kody task as a card in a **lane** (column), and
the lane it lands in is decided by the **engine's own state**, not by the
`kody:*` labels you see on the card. A task is a GitHub issue; the engine
drives it through a pipeline and writes a canonical `kodyState` JSON comment
onto the issue as it goes. The board reads that comment and projects the card
into one of seven lanes. Labels and workflow-run statuses are _projections_ of
the same state that can drift — so they're only a fallback, used when no
canonical state is available.

The single load-bearing rule: **lane comes from `kodyState`, not labels.** A
stale `running` state pins a card in the wrong lane (and can hide its preview);
hand-editing `kody:*` labels does nothing to the lane while a `kodyState`
comment exists. Fix the lane by fixing the engine's state comment, never by
relabelling. This is enforced in
[derive-column.ts](../src/dashboard/lib/tasks/derive-column.ts) and regression-tested
in `tests/unit/derive-column.spec.ts`.

## The pieces

| Piece                   | What it is                                                                                                                                                                               | Where                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Task**                | A GitHub issue. `id` is `<taskId>-<issue#>` when the title carries a `[YYMMDD-…]` task-id bracket, else just the issue number.                                                           | [`/api/kody/tasks`](../app/api/kody/tasks/route.ts) (GET list, POST create)                                                        |
| **`kodyState` comment** | The canonical engine state — a `<!-- kody:state:v1 -->`-bracketed `json` block edited in place on the issue. Holds `core.phase`, `core.status`, `prUrl`, `lastOutcome`, attempts.        | [`kody-state.ts`](../src/dashboard/lib/kody-state.ts)                                                                              |
| **Column derivation**   | Pure function that turns issue + workflow run + PR + `kodyState` + pipeline into one `ColumnId`. Order is load-bearing.                                                                  | [`derive-column.ts`](../src/dashboard/lib/tasks/derive-column.ts)                                                                  |
| **`kody:*` labels**     | Lifecycle phase (`kody:building`, `kody:reviewing`, …) and flow (`kody-flow:feature\|bug\|spec\|chore`). Slow-changing projections; only consulted when `kodyState`/pipeline are absent. | [`constants.ts`](../src/dashboard/lib/constants.ts) (`parseKodyPhase`, `parseKodyFlow`)                                            |
| **Board UI**            | The seven lanes, their icons/labels, and the per-card actions.                                                                                                                           | [`TaskList.tsx`](../src/dashboard/lib/components/TaskList.tsx), [`TaskDetail.tsx`](../src/dashboard/lib/components/TaskDetail.tsx) |
| **Task actions**        | `rerun` / `execute` / `abort` / `close` / `reset` / `fix` / `approve-ui` / `approve-pr` / … — each posts an `@kody` command or mutates the issue.                                        | [`/api/kody/tasks/[taskId]/actions`](../app/api/kody/tasks/[taskId]/actions/route.ts)                                              |
| **Approve gate**        | Atomic approve → squash-merge → (only on success) delete branch + close issue.                                                                                                           | [`/api/kody/tasks/approve`](../app/api/kody/tasks/approve/route.ts)                                                                |

## The seven lanes

`ColumnId` is the full set of lanes
([types.ts](../src/dashboard/lib/types.ts), [constants.ts](../src/dashboard/lib/constants.ts)):

| `ColumnId`     | Board label    | Meaning                                                        |
| -------------- | -------------- | -------------------------------------------------------------- |
| `open`         | Backlog        | Untriaged / not started. The only lane where "Run Task" shows. |
| `building`     | Building       | Engine is actively working (research → plan → implement).      |
| `review`       | In Review      | Work done, PR open and awaiting human review/merge.            |
| `gate-waiting` | Needs Approval | Pipeline paused at a hard-stop / risk gate.                    |
| `retrying`     | Retrying       | Mid-retry (label-driven fallback only).                        |
| `failed`       | Failed         | Run failed/timed out. Card shows a truncated failure reason.   |
| `done`         | Done           | Shipped (merged) or issue closed.                              |

## How a lane is decided

The list route fetches issues, recent workflow runs, and open PRs, matches a
PR and a workflow run to each issue, optionally reads live pipeline JSON, and
batch-reads the `kodyState` comment for any engine-touched issue. It then calls
`deriveTaskColumn`, which applies these signals **in strict priority order**
([derive-column.ts](../src/dashboard/lib/tasks/derive-column.ts)):

```
deriveTaskColumn(issue, workflowRun, associatedPR, kodyState, pipelineStatus)
│
├─ 1. issue.state === "closed" ........................... → done
│
├─ 2. kodyState wins over a stray active run:
│        phase === "shipped" ............................. → done
│        phase/status === "failed" ....................... → failed
│      (guards against an unrelated run whose title contains
│       "#<issue>" flipping a shipped task back to "building")
│
├─ 3. live pipelineStatus, when fresh:
│        running → building · paused → gate-waiting
│        completed → review · failed/timeout → failed
│      (a "completed/failed" pipeline + an active run = stale ⇒ building)
│
└─ 4. fallback — getColumnForIssue(labels, run, PR, kodyState):
         kodyState.core:
           phase shipped → done · failed → failed
           status running + reviewing + PR → review
           status running + phase ≠ idle → building   (idle is parked,
                                                        NOT active work)
           status succeeded + open PR → review · merged PR → done
         then: active run → building
         then: kody:* phase labels → failed/done/review/building
         then: PR open mid-flow labels → building, else → review
         then: generic labels (released/review/pr/…) → their lane
         else → open
```

Two subtleties worth keeping in mind:

- **`idle` is not "running."** A `status: running` + `phase: idle` state is a
  _parked_ task (classified but no working phase started, or a phase ended
  without finalizing). Returning `building` for it makes backlog issues flap
  into "running" whenever that stale state is read, so derivation deliberately
  falls through. A genuinely live run is still caught by the active-run check.
- **The engine state beats a stray workflow run.** Workflow runs are matched to
  issues partly by `#<number>` substring in the run's display title, which can
  false-match. The `shipped`/`failed` short-circuits at step 2 exist precisely
  so a completed task doesn't visibly jump back to "Building" on the next poll.

### Why editing labels does nothing

`kody:*` labels are read only at step 4, **after** `kodyState` and live
pipeline have had their say. While the engine's `kodyState` comment says
`phase: running`, the card stays in "Building" no matter what labels you
add or remove — and if that `running` state is stale (the run already died),
the card is stuck and its preview is suppressed until the engine rewrites the
comment. The fix is always to correct the engine state (e.g. the engine's
`finalizeGoal` / finalize step rewriting `kodyState`), never to relabel.

## Task types & their lifecycle

The flow type lives in `kody-flow:*` labels and is parsed into `kodyFlow`
(`feature` | `bug` | `spec` | `chore`):

- **`feature` / `bug` / `chore`** — single-session, PR-branch primitives. One
  engine run takes the issue from research/plan straight through implementation
  to one PR. No multi-stage orchestration.
- **`spec`** — the only multi-stage flow: it fans out across phases before
  converging.
- **Goals** — not a `kody-flow`; a goal runs **N phase tasks** whose changes
  **consolidate into one PR against the `dev` branch**. Per-phase PRs are
  closed unmerged by design; merging the consolidated PR is what ships the
  goal. (See [goals.md](./goals.md) if present, and the goal-label handling in
  the actions route via `GOAL_LABEL_PREFIX`.)

`kodyState.core.phase` itself is the engine's own enum
(`idle → research → planning → implementing → reviewing → shipped` / `failed`),
distinct from the label-derived `KodyPhase`
(`classifying`/`running`/`fixing`/…). The board reads the comment's `phase`;
the `kody:*` labels are the human-visible projection.

## Where task state actually lives

This trips people up, so it's worth being precise:

| State                         | Stored as                                                          | Read by                                                           |
| ----------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Per-task `kodyState`          | A **comment on the GitHub issue** (repo-global, not branch-scoped) | `fetchKodyState` → `fetchComments` → `findKodyStateInComments`    |
| Goal/job file state, cursors  | Files in the **configured Kody state repo**                        | State-repo readers such as `readStateText` / `listStateDirectory` |
| Human config (`.md`, prompts) | The **default branch**                                             | their own readers                                                 |

So the broad rule "all machine-written engine state goes to the configured Kody
state repo, never the consumer default branch" holds for **file-based** state —
goal `state.json`, per-job cursors, activity. The per-_task_ `kodyState` the
board uses for lane derivation is the exception: it rides as **issue comment**,
which GitHub stores repo-level independent of any branch. The board reads it
via `fetchComments`, not by reading file state from the state repo. Both "the
engine writes it"; only the file-based half lives in state repo.

When multiple `kodyState` comments exist (a re-classify or self-dispatch retry
can post a fresh one while the canonical one is edited in place),
`findKodyStateInComments` picks the comment with the newest `updated_at` —
_not_ list order — because the engine bumps `updated_at` on every in-place edit
and a later-_created_ duplicate is usually the stale one. Picking by list
position was the original cause of finished tasks flapping back to "running."

## Lifecycle & actions

```
                    POST /api/kody/tasks  (create issue)
                              │  autoTrigger ⇒ posts "@kody"
                              ▼
        ┌──────────── open (Backlog) ────────────┐
        │  "Run Task"  →  POST .../actions execute │
        └────────────────────┬────────────────────┘
                             │ engine starts, writes kodyState
                             ▼
   ┌──────── building ───────┐   abort → cancel run + strip kody:* lifecycle
   │ research→plan→implement │   reset → close PR + del branch + re-@kody
   └────────────┬────────────┘
                │ engine opens PR, phase → reviewing/succeeded
                ▼
   ┌──────── review (In Review) ────────────────────────────────────┐
   │  approve-pr  → review APPROVE + pr-approved label                │
   │  approve     → APPROVE → squash-merge → (on success) del+close   │
   │  fix         → "@kody fix" on the PR + kody:fixing (→ building)  │
   │  approve-ui  → ui-approved label                                 │
   │  report-issue→ kody:needs-fix, strip done/failed (→ leaves done) │
   └────────────┬────────────────────────────────────────────────────┘
                │ merge lands / issue closed
                ▼
            done (Done)              failed (Failed)  ← phase/status failed
```

Notes that matter:

- **`approve` is atomic and gated.** It approves the review, then squash-merges;
  only if the merge actually succeeds does it delete the branch and close the
  issue. A blocked merge (failing CI, conflict) returns `409` and leaves branch
  - issue intact — it never destroys work on a failed merge.
    ([approve/route.ts](../app/api/kody/tasks/approve/route.ts))
- **`fix` requires an associated PR** — it posts `@kody fix` onto that PR
  (engine semantics: `fix` applies feedback to an existing PR branch). It also
  optimistically strips `kody:done`/`kody:failed` and adds `kody:fixing` so the
  card jumps to "Building" immediately; the engine self-heals the label and the
  `kodyState` comment overrides it once the run starts.
- **`abort`** cancels matched in-progress runs and strips in-flight `kody:*`
  lifecycle labels (terminal `kody:done`/`kody:failed` preserved) so the card
  leaves "Building" even when the run was already winding down.
- **Optimistic UI** moves the card client-side (`open → building` on run,
  reverts on error) — the server poll then confirms via `kodyState`.

## Cost guard (read before touching the list route)

The task list is a hot polled endpoint sharing the 5000-req/hr GitHub budget.
The route is built to stay cheap and the rules are load-bearing (see the
GitHub rate-limit section in [../CLAUDE.md](../CLAUDE.md)):

- `kodyState` is **only** read for engine-touched issues (a `kody:*` label or a
  matched run), and it reuses `fetchComments`' ETag/304 cache — so re-reads are
  free until the comment is edited.
- Pipeline JSON and branch lookups are skipped for terminal (`kody:done` /
  `kody:failed`) tasks unless an active run overrides them.
- `view=running` drops `done`/`failed`/`open` from the payload (Active tab);
  `view=backlog` returns only `open`.

Never add `noCache: true` to "fix staleness"; lower the TTL, call
`invalidateTaskCache()` after writes, or update the client optimistically.

## File reference

| File                                                                                           | Purpose                                                          |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [`tasks/derive-column.ts`](../src/dashboard/lib/tasks/derive-column.ts)                        | Pure lane derivation — the priority order above. **Read first.** |
| [`kody-state.ts`](../src/dashboard/lib/kody-state.ts)                                          | Parse the canonical `kodyState` comment; newest-wins selection.  |
| [`state-repo.ts`](../src/dashboard/lib/state-repo.ts)                                          | Resolves and reads/writes the configured Kody state repo.        |
| [`constants.ts`](../src/dashboard/lib/constants.ts)                                            | `ColumnId`, `COLUMN_DEFS`, `parseKodyPhase`, `parseKodyFlow`.    |
| [`types.ts`](../src/dashboard/lib/types.ts)                                                    | `KodyTask`, `GitHubIssue`/`PR`/`WorkflowRun`, `ColumnId`.        |
| [`/api/kody/tasks/route.ts`](../app/api/kody/tasks/route.ts)                                   | GET list (derivation orchestration) + POST create.               |
| [`/api/kody/tasks/[taskId]/actions/route.ts`](../app/api/kody/tasks/[taskId]/actions/route.ts) | Per-task actions (rerun/execute/abort/fix/approve-ui/…).         |
| [`/api/kody/tasks/approve/route.ts`](../app/api/kody/tasks/approve/route.ts)                   | Atomic approve → squash-merge → cleanup gate.                    |
| [`/api/kody/tasks/closed/route.ts`](../app/api/kody/tasks/closed/route.ts)                     | Lightweight closed-task list (no derivation), per goal label.    |
| [`components/TaskList.tsx`](../src/dashboard/lib/components/TaskList.tsx)                      | Lane icons/labels, card list.                                    |
| [`components/TaskDetail.tsx`](../src/dashboard/lib/components/TaskDetail.tsx)                  | Per-task detail + action buttons.                                |
| [`components/TaskTypeBadge.tsx`](../src/dashboard/lib/components/TaskTypeBadge.tsx)            | Feature/Bug/Refactor/Spec type badge.                            |
| `tests/unit/derive-column.spec.ts`                                                             | Regression suite for the derivation order.                       |

## FAQ

**A card is stuck in "Building" but the run finished — why, and how do I fix it?**

Its `kodyState` comment still says `phase/status: running` (a stale state, e.g.
a finalize step that never wrote `shipped`). Derivation reads that comment
_before_ labels, so the card is pinned and its preview suppressed. Fix the
engine's state comment (the finalize path that rewrites `kodyState`); editing
`kody:*` labels won't move it.

**I changed the `kody:*` labels and the lane didn't change. Bug?**

No — by design. Labels are step 4, the last-resort fallback. While a
`kodyState` comment exists, it (and live pipeline JSON) decide the lane;
labels are ignored.

**What's the difference between `kodyPhase` and `kodyState.core.phase`?**

`kodyPhase` is parsed from `kody:*` labels (the human-visible projection);
`kodyState.core.phase` is the engine's canonical enum read from the state
comment. The board derives the lane from the latter and shows the former as a
chip.

**Where does task state live — the `kody-state` branch or the issue?**

Per-_task_ state is an issue **comment** (repo-global, not branch-scoped).
The configured Kody state repo holds **file-based** state — goal `state.json`,
per-job cursors, activity. Both are engine-written; only the file-based half
sits on the branch.

**Why is the close/reset action so heavy?**

`close` closes the PR, deletes the work branch, and closes the issue; `reset`
does that _and_ re-triggers the pipeline with a fresh `@kody`. Both are
deliberate so a card doesn't leave a dangling branch/PR behind.

**Does approving ever merge a PR with failing CI?**

No. `approve` squash-merges first and only deletes the branch / closes the
issue if the merge succeeds; a CI-blocked or conflicting merge returns `409`
and leaves everything intact.
