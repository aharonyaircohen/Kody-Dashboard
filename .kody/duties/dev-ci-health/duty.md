# Dev CI Health

## Job

Watch the `dev` branch CI and open or reuse one tracking issue when the branch is red.

## Executable

Run the `dev-ci-health` executable. Its skill owns the detailed method and runtime state handling.

## Output

A tracking issue plus one repair dispatch when a new dev CI failure appears.

## Allowed Commands

- Run the `dev-ci-health` executable.

## Restrictions

- Do not create duplicate repair issues.
- Do not fix CI directly.
- Dispatch repair only through the configured executable path.
- Stop when a repair is already in flight.
