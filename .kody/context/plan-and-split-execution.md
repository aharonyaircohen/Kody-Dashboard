---
agent: [kody]
---

# Plan-and-Split Execution

For complex features that touch multiple layers (db, api, server, ui, admin, etc.), split the work by expertise and merge the parts into one final result. Capture the **decisions and the rejected alternatives** so the next person doesn't redo the argument.

## The decisions (and the ones we rejected)

1. **Engine splits, executable doesn't.** The executable is the expert (db, api, ui, …) and receives an already-scoped sub-task. It does not decide the slice, does not know the others exist, does not wait. Rejected: putting the split in the executable — that turns the expert into a coordinator and breaks the leaf model. Rejected: putting the split in the duty — that's a cron loop, not a planner.

2. **Duty is a cron trigger, nothing more.** It ticks, finds tasks that have a job attached and haven't started, and fires the job. No state, no polling on children, no escalation logic. Rejected: bolting state and waits onto a duty — the duty model wasn't built for that, and adding memory doesn't change the shape, it just hides it.

3. **Job lives on the task, not in code.** The job is a small plan on the issue: "this task splits into N sub-tasks, one per executable, with these slice boundaries." Metadata on the issue, parsed by the engine. Not a new storage location, not a new registry. Rejected: a separate `.kody/jobs/` directory — the engine already keeps tasks and executables apart (`.kody/tasks/` vs `.kody/executables/`), so the job belongs with the task it describes.

4. **Engine change is small and additive.** One new "plan mode": given a list of executables, create the sub-tasks, dispatch them, wait for the PRs, open the final PR. Same branch/PR flow the engine already uses for `run` — just N children gated on each other. Rejected: a new "orchestrator" layer between duty and executable — adds a third primitive to do work the engine can already do. Rejected: a new executable kind named "orchestrate" — same effect, but conflates the coordinator with an expert.

5. **No third layer.** The final stack is duty → task (carries job) → engine (splits) → executable (runs). Four pieces, each with one job. Rejected: duty / orchestrator / executable — adds state and confusion, doesn't add capability.

## The shape (one line per piece)

- **Duty** = when to look. Thin cron loop. Finds tasks with unattached jobs, fires them.
- **Task** (issue) = what to do. Carries a **job** describing the split and the slice boundaries.
- **Job** (on the task) = how to split. "N sub-tasks, one per executable, each scoped to its slice." Lives on the issue as a small block the engine parses. Not in code.
- **Engine** = who splits and who waits. Reads the job, creates the sub-tasks, dispatches each to its executable, waits for the sub-PRs to merge, opens the final aggregated PR.
- **Executable** = the expert. Receives a sub-task already scoped to its layer. Runs, opens its PR, done. No splitting, no waiting, no awareness of the others.

## Why this shape wins

- **Expertise stays in the executable.** No re-training, no re-prompting, no new tools.
- **Duties stay cron loops.** The model that works for "every 5 min" works for "complex feature splits" without distortion.
- **The engine grows one capability, not a new layer.** Smaller surface, fewer concepts.
- **The job is just data.** A future change to *how* we split is a change to the plan, not to the engine.

## Open questions (deferred)

- Slice boundaries: who writes them? Default answer — the human who opens the task, in the job block. Engine doesn't infer them.
- Failure mode: if one child PR is rejected, do we block the final PR or open it with the gap? Default — block and escalate to the human.
- Re-entry: if a child PR is re-dispatched (fix / rerun), does the parent re-wait? Default — yes, the engine treats the child PR as not-merged-until-merged.

## What doesn't change

- Duty model: still a cron loop.
- Executable model: still the leaf expert.
- Branch / PR flow: unchanged.
- Storage: job is metadata on the issue, no new location.
