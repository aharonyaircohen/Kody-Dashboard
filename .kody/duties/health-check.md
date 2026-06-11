---
every: 1d
staff: kody
stage: report-refresh
executables: health-check
disabled: true
---

# Kody Health Check

## Job

Report Kody-assigned tasks that have not been updated within the expected window.

## Executable

Run the `health-check` executable. Its skill owns the detailed method and runtime state handling.

## Output

Refresh `.kody/reports/health-check.md`.

## Allowed Commands

- Run the `health-check` executable.

## Restrictions

- Read-only on scanned issues.
- Do not re-kick or relabel tasks.
- Never create or comment on issues from this duty.
- Only write the health-check report.
