---
every: manual
staff: kody
stage: sweep
executables: cleanup-branches
disabled: true
---

# Clean Up Branches

## Job

Delete stale task branches whose linked task is closed, done, or failed.

## Executable

Run the `cleanup-branches` executable. Its skill owns the detailed method and runtime state handling.

## Output

A summary of deleted and skipped branches.

## Allowed Commands

- Run the `cleanup-branches` executable.

## Restrictions

- Never delete protected branches.
- Never delete a branch with an open PR.
- Never delete a branch tied to open or in-progress work.
- Skip ambiguous branch-to-issue matches.
