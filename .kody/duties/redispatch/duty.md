# Redispatch

## Job

Find Kody-owned issues that appear stuck and safely redispatch them.

## Executable

Run the `redispatch` executable. Its skill owns the detailed method and runtime state handling.

## Output

A resume comment, stuck marker, or dry-run summary depending on the executable mode.

## Allowed Commands

- Run the `redispatch` executable.

## Restrictions

- Never redispatch fresh work.
- Respect no-redispatch and stuck labels.
- Do not edit issue bodies or code.
- Do not resume the same issue more than once per UTC day.
