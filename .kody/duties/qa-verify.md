---
every: 30m
staff: qa
stage: approval-gate
executables: qa-verify
---

# QA Fix Verification

## Job

Re-check delivery PRs against their previews before merge and route pass/fail outcomes to the inbox.

## Executable

Run the `qa-verify` executable. Its skill owns the detailed method and runtime state handling.

## Output

A UI-review dispatch, merge recommendation, fix recommendation, or trusted merge action.

## Allowed Commands

- Run the `qa-verify` executable.

## Restrictions

- One review in flight at a time.
- Do not edit code.
- Only merge automatically after trust graduation.
- Use the UI-review verdict, not labels alone, for pass/fail decisions.
