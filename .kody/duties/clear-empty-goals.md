---
every: 1d
staff: kody
stage: simple-check
executables: clear-empty-goals
disabled: true
---

# Clear Empty Goals

## Job

Find goals that contain no tasks and remove or report them according to the executable method.

## Executable

Run the `clear-empty-goals` executable. Its skill owns the detailed method and runtime state handling.

## Output

A short cleanup summary.

## Allowed Commands

- Run the `clear-empty-goals` executable.

## Restrictions

- Only act on goals with zero tasks.
- Do not touch goals that have tasks, history, or unclear ownership.
- Keep the action idempotent.
