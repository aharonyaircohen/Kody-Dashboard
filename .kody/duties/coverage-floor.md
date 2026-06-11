---
every: 1d
staff: cto
stage: sweep
executables: coverage-floor
disabled: true
---

# Coverage Floor

## Job

Check CI coverage against the floor and escalate when statements or branches drop too low.

## Executable

Run the `coverage-floor` executable. Its skill owns the detailed method and runtime state handling.

## Output

A tracking issue, closing comment, or trend warning when coverage changes need attention.

## Allowed Commands

- Run the `coverage-floor` executable.

## Restrictions

- Do not edit code.
- Do not run coverage locally.
- Use CI artifacts as the source of truth.
- Open at most one issue or comment per tick.
