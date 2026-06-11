# Systematic Debugging

Use this skill when fixing a bug or targeted enhancement.

## Workflow

1. Reproduce first.
   - Identify expected behavior, actual behavior, and the smallest code path
     that shows the gap.
   - Add or update a focused test that asserts the correct behavior.
   - Run the test once and confirm it fails for the right reason, not because
     of syntax, import, or fixture setup.
   - Record the failure signature: error type and distinctive message text.

2. Research before editing production code.
   - Read the full contents of every file you intend to change.
   - Read the tests for those files.
   - Read a sibling module that already implements the same pattern and mirror
     that convention unless there is a clear reason not to.
   - For removals or renames, search tests for spies, literal names, mock call
     assertions, and strings tied to the old behavior.
   - Load external non-GitHub URLs from the issue with Playwright MCP when they
     are part of the specification.

3. Plan briefly before editing.
   - Name the root cause, exact files, minimal fix, mirrored pattern, tests,
     and regression risk.
   - Revise the plan if research proves it wrong.

4. Fix the root cause.
   - Make the reproducing test pass without weakening it.
   - Do not skip the test, loosen assertions, or change expectations to match
     buggy output.
   - Keep edits inside the issue scope.

5. Verify.
   - Call the configured verify tool before reporting success.
   - If verification fails, fix the introduced root cause and retry within the
     allowed attempts.
   - Treat unrelated pre-existing gate failures as out of scope unless the
     edited files or behavior are related.

## Boundaries

- Do not run git or gh; the wrapper handles repository operations.
- Do not post comments; the wrapper handles reporting.
- Do not make speculative refactors or adjacent cleanups.
- If an adjacent bug is found, mention it in the summary without fixing it.
- Do not modify forbidden/generated paths unless the issue explicitly requires
  it.
