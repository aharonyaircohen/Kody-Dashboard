# Bug Reproduction

Use this skill to write the canonical failing test for a bug before any fix.

## Workflow

1. Understand the bug.
   - Identify expected behavior, actual behavior, and the smallest code path
     that exhibits the gap.

2. Locate the right test home.
   - Read the repo's test structure.
   - Prefer an existing nearby test file.
   - Copy imports, setup, fixtures, and assertion idioms from the newest fitting
     sibling test.

3. Write one minimal failing test.
   - Assert the correct behavior.
   - Do not modify production code.
   - Do not skip, todo, or `expect.fail` the test.
   - Name a new file after the issue when creating one.

4. Run the test once.
   - Capture non-zero exit code.
   - Capture error type.
   - Capture a distinctive message substring.
   - Capture a production stack-frame anchor when visible.

5. Refine only when needed.
   - If the test passes, it is not catching the bug; refine and rerun.
   - If it fails for setup/import/syntax reasons, fix the test and rerun.
   - If a meaningful failure cannot be produced after a couple attempts, fail
     with the blocker.

## Boundaries

- Do not fix the bug.
- Do not run git or gh.
- Do not post comments.
- Do not modify forbidden/generated paths.
- The committed test is expected to stay red until the fix lands.
