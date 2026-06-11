---
every: 1d
staff: ceo
stage: sweep
executables: job-gap-scan
disabled: true
---

# Job Gap Scan

## Job

Propose one high-ROI missing duty or job that the system does not already have.

## Executable

Run the `job-gap-scan` executable. Its skill owns the detailed method and runtime state handling.

## Output

A proposal issue for operator approval.

## Allowed Commands

- Run the `job-gap-scan` executable.

## Restrictions

- One proposal per tick.
- Do not create the duty directly.
- Never re-propose rejected ideas.
- Respect dismissed ideas until their cooling-off window expires.
