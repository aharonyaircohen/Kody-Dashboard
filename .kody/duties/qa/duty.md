# QA Changelog Verification

## Job

Verify shipped but unverified changelog entries against the live app.

## Executable

Run the `qa` executable. Its skill owns the detailed method and runtime state handling.

## Output

A changelog QA marker update and inbox recommendation when a result needs attention.

## Allowed Commands

- Run the `qa` executable.

## Restrictions

- One QA run in flight at a time.
- Only edit QA markers on changelog bullets.
- Do not rewrite release notes.
- Do not create fix goals without operator approval.
