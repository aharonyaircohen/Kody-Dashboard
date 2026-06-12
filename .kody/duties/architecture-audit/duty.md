# Architecture Audit

## Job

Run a periodic architecture-health sweep for boundaries, coupling, dependency direction, dead abstractions, and duplication.

## Executable

Run the `architecture-audit` executable. Its skill owns the detailed method and runtime state handling.

## Output

A tracking issue or tracking-issue comment for the architecture sweep.

## Allowed Commands

- Run the `architecture-audit` executable.

## Restrictions

- Read-only on the codebase.
- At most one tracking issue or comment per tick.
- Do not run build, test, lint, or code edits directly from the duty.
- Only escalate concrete architecture risks.
