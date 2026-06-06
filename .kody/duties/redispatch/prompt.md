# redispatch

## Job

For every open issue that kody is actively working on but appears stuck: post the comment `@kody resume` on the issue so the engine re-dispatches from its last persisted state. Otherwise do nothing.

This job is a safety net, not a fix. It catches issues where the state machine ended a phase (e.g. `CLASSIFIED_AS_BUG`) but never advanced to the next executable. It does not diagnose why the stall happened — that is for the engine team to debug from the resume log.

An issue enters this job's scope when it has a kody state block (`<!-- kody:state:v1:begin -->` … `<!-- kody:state:v1:end -->`), is open, and the persisted `core.status` is `running`. It leaves scope when it is closed, when `core.status` is no longer `running`, or when its most recent history entry is fresh.

## Allowed Commands

`@kody resume`

## Restrictions

- **Dry-run mode is currently ENABLED** in [redispatch-tick.py](.kody/scripts/redispatch-tick.py) (`DRY_RUN = True`). While dry-run is on: no `@kody resume` comment is posted, no stuck comment is posted, no `kody:stuck` label is added. Every actionable candidate is recorded in `data.dryRunLog` (capped at 50). To go live, flip the flag in the script (and remove this bullet).
- **Live-test scope gate is currently ENABLED** in the script (`LIVE_TEST_LABEL = "kody:test-redispatch"`). When dry-run is OFF, only issues carrying that label receive comments/labels. While dry-run is ON, the gate doesn't suppress logging — every candidate still appears in `dryRunLog`.
- Only act when ALL of these hold for an issue (the script enforces these — do not re-implement in the prompt):
  - `core.status === "running"` in the most recent kody state block.
  - The most recent `history[*].timestamp` (or `core.lastOutcome.timestamp` if history is empty) is older than **40 minutes**.
  - No in-progress `workflow_run` references this issue (matched by issue number in title or branch).
  - No open kody-authored PR is linked to this issue (`core.prUrl` resolves to an open PR).
  - No comment authored by `kody` (or recognizable `@kody …`/`✅ kody …`/`⚙️ kody …` lines) has been posted on the issue in the last 40 minutes.
- Issues with the labels `kody:stuck`, `kody:no-redispatch`, or `kody:stalled` are excluded.
- Do not modify the issue body, the issue title, labels (except as the script does), or any code.
- Do not re-issue `@kody resume` on the same issue more than **1 time per UTC day**.
- After 1 failed auto-resume attempt that did not advance the state within 40 minutes: post `kody resume did not advance state — needs human`, add label `kody:stuck`, skip until the label is removed or the state advances. (When dry-run is on, this is logged as `mark-stuck` in `dryRunLog` instead.)

## Tick procedure

The tick is fully scripted. Past iterations of this job used a prose iteration that scanned ~30 open issues, fetched comment history per issue, and crashed with `error_max_turns` on most ticks. The deterministic operations now live in `.kody/scripts/redispatch-tick.py`.

**Step 1 — Run the tick script:**

```
python3 .kody/scripts/redispatch-tick.py
```

**Step 2 — Emit the script's stdout verbatim**, including the markdown summary table and the `kody-job-next-state` fenced block at the end. Do not paraphrase, edit, reorder, or compute anything yourself. The script's output is the entire tick result.

If the script exits non-zero, surface its stderr and emit a state block with `cursor: "redispatch-error-<now>"` and the prior state unchanged so the engine doesn't lose progress.

## State shape

`data.perIssue` is a map of issue number → `{ lastResumedAt: ISO, lastResumedHistoryTimestamp: ISO, attemptsToday: number, stuck: boolean }`.

`data.dryRunLog` is an array (FIFO, capped at 50) of `{ issueNumber, action, reason, plannedAt }` entries, populated only while dry-run mode is enabled.
