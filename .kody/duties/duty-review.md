---
every: 6h
staff: coo
stage: review-loop
executables: duty-review
disabled: true
---

# Duty Review

## Job

Review one duty at a time for design soundness, reachable steps, cadence, and observed output.

## Executable

Run the `duty-review` executable. Its skill owns the detailed method and runtime state handling.

## Output

A finding comment or cycle summary on the duty-review tracking issue.

## Allowed Commands

- Run the `duty-review` executable.

## Restrictions

- Do not execute or fix the reviewed duty.
- Do not review yourself.
- One duty and one comment at most per tick.
- Read-only except for the tracking issue.
