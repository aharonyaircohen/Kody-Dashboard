# System Audit

## Job

Audit `.kody/` coordination for broken references, missed ticks, missing state, stuck dispatches, and duplicate dispatches.

## Executable

Run the `system-audit` executable. Its skill owns the detailed method and runtime state handling.

## Output

A consolidated comment on the Kody system audit tracking issue when findings exist.

## Allowed Commands

- Run the `system-audit` executable.

## Restrictions

- Read-only except for the system-audit tracking issue.
- One comment per tick.
- Do not fix, relabel, or re-kick anything.
- Stay quiet when there are no findings.
