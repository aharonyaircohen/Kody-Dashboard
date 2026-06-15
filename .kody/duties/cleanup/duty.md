# Cleanup - branches, empty goals, dependency nudges, and dead-code signals

## Job

Coordinate repository housekeeping from one place: stale task branches, empty goals, dependency-bump nudges, and dead-code cleanup signals.

## Executable

Run the `cleanup` executable. Its skills own the branch, goal, dependency, and dead-code cleanup methods.

## Output

A cleanup summary, tracking issue, cleanup task, dependency-bump nudge, or quiet no-op when nothing is actionable.

## Allowed Commands

- Run the `cleanup` executable.

## Restrictions

- Disabled until the operator enables this grouped cleanup.
- Do not delete protected branches, branches with open PRs, or branches tied to active work.
- Only act on goals with zero tasks and clear ownership.
- Do not edit dependency files or delete code directly.
- Delegate actual dependency/dead-code changes through bounded follow-up work.
