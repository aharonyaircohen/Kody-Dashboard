# PR Health Triage

## Job

Review open PRs for conflicts, failed CI, or stale branches, then recommend or dispatch the trusted repair.

## Executable

Run the `pr-health-triage` executable. Its skill owns the detailed method and runtime state handling.

## Output

A PR repair recommendation or trusted repair dispatch.

## Allowed Commands

- Run the `pr-health-triage` executable.

## Restrictions

- Only `fix-ci`, `sync`, or `resolve` repairs are in scope.
- One repair comment per PR per tick.
- Never merge, close, approve, relabel, or edit files.
- Trust-ledger uncertainty means ask.
