# Implementation Session

Use this skill when implementing a feature, refactor, or scoped enhancement.

## Workflow

1. Research before editing.
   - Load external references from the issue with Playwright MCP when they are
     part of the specification.
   - Read the full contents of every file you intend to change.
   - Read tests for those files when they exist.
   - Read a sibling module that implements the same pattern and mirror the
     repo convention unless there is a clear reason not to.
   - For removals or renames, search tests for spies, literal names, mock call
     assertions, and output strings tied to the old behavior.

2. Plan briefly.
   - Name the files, approach, reused pattern, tests, and regression risk.
   - Update the plan if research disproves it.

3. Build inside scope.
   - Keep edits tied to the issue.
   - Avoid speculative refactors and adjacent cleanup.
   - Preserve local formatting/import/test conventions.

4. Test changed behavior.
   - Add or update tests for new modules and changed behavior.
   - Copy imports, setup hooks, fixtures, and auth patterns from the nearest
     existing tests.
   - Cover meaningful success and failure paths when behavior changes.
   - If something is untestable, name the concrete blocker in the summary.

5. Verify.
   - Call the configured verify tool before reporting success.
   - If verification fails, fix the introduced root cause and retry within the
     allowed attempts.

## Boundaries

- Do not run git or gh; the wrapper handles repository operations.
- Do not post comments; the wrapper handles reporting.
- Do not modify forbidden/generated paths unless the issue explicitly requires
  it.
- Treat unrelated pre-existing gate failures as out of scope unless the edits
  touched related code or behavior.
