---
every: 7d
staff: coo
stage: sweep
executables: dependency-bump
disabled: true
---

# Dependency Bump

## Job

Track stale production dependencies and keep at most one bump PR in flight.

## Executable

Run the `dependency-bump` executable. Its skill owns the detailed method and runtime state handling.

## Output

A weekly dependency-bump tracking issue or nudge.

## Allowed Commands

- Run the `dependency-bump` executable.

## Restrictions

- Do not edit dependency files directly.
- Do not run package changes from the duty.
- Keep only one bump in flight.
- Do not repeat recently failed package attempts.
