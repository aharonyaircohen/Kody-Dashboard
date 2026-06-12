# Design Review

## Job

Run a periodic design-health sweep for visual coherence, usability, and accessibility risks.

## Executable

Run the `design-review` executable. Its skill owns the detailed method and runtime state handling.

## Output

A tracking issue or nudge for the design sweep.

## Allowed Commands

- Run the `design-review` executable.

## Restrictions

- Do not edit UI directly.
- Do not open PRs from the duty.
- At most one tracking issue or comment per tick.
- Report concrete user-visible issues only.
