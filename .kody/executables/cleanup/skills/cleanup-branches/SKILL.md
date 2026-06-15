---
name: cleanup-branches
description: Delete stale task branches whose linked task is closed, done, or failed.
---

# Clean Up Branches Skill

Use this skill when the `cleanup-branches` executable runs from the matching duty.

Runtime state is owned by the engine. Do not ask the duty author to configure raw state keys.

## Method

## Job

Delete stale task branches: any branch whose linked task issue is **closed**, **done**, or **failed**. Keep every branch that belongs to an open or in-progress task.

This job is **manual** by default — trigger it from the Jobs page ("Run now"). It replaces the old dashboard-header "Clean up branches" button (which listed deletable branches for closed/failed/done tasks and bulk-deleted the selected ones). Bump `every` to a cadence (e.g. `7d`) if you'd rather it sweep automatically.

## Allowed Commands

`gh api`, `gh pr list`, `gh issue view`, `git push origin --delete <branch>`

## Restrictions

- Only delete a branch when its associated task issue is `closed`, `done`, or `failed`. Never delete a branch tied to an open / in-progress / running task.
- Never delete protected branches: `main`, `master`, `dev`, `develop`, or `HEAD`.
- Never delete a branch that still has an **open** PR — even if the issue looks closed.
- Match a branch to its task by the issue number embedded in the branch name (and confirm via `gh issue view`); if the link is ambiguous, skip the branch rather than guess.
- Report every deleted branch with its issue number and the status that made it eligible (`closed` / `done` / `failed`). Report skipped branches and why.
