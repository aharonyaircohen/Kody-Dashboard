# Dead Code Sweep

## Job

Coordinate monthly cleanup of unused exports, files, and dependencies.

## Executable

Run the `dead-code-sweep` executable. Its skill owns the detailed method and runtime state handling.

## Output

A monthly tracking issue or nudge for dead-code cleanup.

## Allowed Commands

- Run the `dead-code-sweep` executable.

## Restrictions

- Do not delete files directly.
- Delegate actual cleanup through a bounded chore task.
- One issue or comment per tick.
- Honor the do-not-delete list in the skill.
