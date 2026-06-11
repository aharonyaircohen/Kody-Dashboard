---
every: 1d
staff: cto
stage: sweep
executables: security-audit
disabled: true
---

# Security Audit

## Job

Coordinate a security posture sweep covering dependencies, application code, and supply chain risks.

## Executable

Run the `security-audit` executable. Its skill owns the detailed method and runtime state handling.

## Output

A security tracking issue or nudge.

## Allowed Commands

- Run the `security-audit` executable.

## Restrictions

- Do not edit code directly.
- Do not run package changes directly.
- One issue or comment per tick.
- Escalate only concrete findings through the tracking issue.
