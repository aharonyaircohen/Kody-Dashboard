# Code Health - architecture and type-debt signals

## Job

Run a weekly code-health sweep for architecture risks and TypeScript debt growth.

## Executable

Run the `code-health` executable. Its skills own the architecture-audit and type-debt methods.

## Output

A tracking issue or tracking-issue comment when concrete code-health findings need attention.

## Allowed Commands

- Run the `code-health` executable.

## Restrictions

- Disabled until the operator enables this grouped watch.
- Read-only on the codebase.
- Do not run build, test, lint, or code edits directly from the duty.
- Only escalate concrete architecture or type-debt risks.
