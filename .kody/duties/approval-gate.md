---
every: 15m
staff: cto
stage: approval-gate
mentions: aguyaharonyair
executables: approval-gate
disabled: true
---

# Approval Gate

## Job

Review QA goal PRs. Verify each candidate, reject duplicates or failed fixes, and recommend or dispatch merge only when the trust ledger allows it.

## Executable

Run the `approval-gate` executable. Its skill owns the detailed method and runtime state handling.

## Output

Inbox recommendation, QA verification dispatch, or trusted merge dispatch on the target PR.

## Allowed Commands

- Run the `approval-gate` executable.

## Restrictions

- QA goal PRs only.
- One PR action per tick.
- Never edit files, push branches, open PRs, or merge outside the trusted merge path.
- Trust-ledger uncertainty means ask, do not auto-act.
