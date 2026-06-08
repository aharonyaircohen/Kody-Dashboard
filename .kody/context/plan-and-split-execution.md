---
staff: [kody]
---

# Plan-and-Split Execution

For complex features that touch multiple layers (db, api, server, ui, admin, etc.), split the work by expertise and merge the parts into one final result.

## The rule

- **Duty** = when to look. Stays a thin cron loop. Doesn't split, doesn't wait, doesn't coordinate.
- **Task** (issue) = what to do. Carries a **job** describing the split.
- **Job** = the plan. Lives on the task, not in code. Says "this task splits into N sub-tasks, one per executable" and names each executable's slice.
- **Engine** = who splits. Reads the job, creates one sub-task per executable (each already scoped to that executable's slice), dispatches them, waits for the sub-PRs to merge, then opens the final aggregated PR.
- **Executable** = the expert. Receives a sub-task that's already scoped to its layer. Runs, opens its PR, done. It does not split. It does not wait. It does not know the others exist.

## Why a duty is the wrong primitive

A duty is a loop on a cron. The plan-and-split pattern happens once per issue with a clear end. Forcing a duty to do it means inventing state, waits, ceilings, and escalation — work the duty model was never designed to carry.

## Engine change (small)

One new "plan mode": given a list of executables, create the sub-tasks, run them, wait for the PRs, open the final PR. Same branch/PR flow the engine already uses for `run` — just N children gated on each other.

## What doesn't change

- Duty model: still a cron loop.
- Executable model: still the leaf expert.
- Branch / PR flow: unchanged.
- Storage: job is metadata on the issue, no new location.
