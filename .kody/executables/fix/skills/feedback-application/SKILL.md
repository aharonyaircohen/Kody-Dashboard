# Feedback Application

Use this skill when applying review feedback to an existing PR branch.

## Workflow

1. Extract feedback items.
   - Treat headings such as `Concerns`, `Suggestions`, and `Bugs` as groups of
     actionable items.
   - Ignore praise, summaries, bottom lines, questions, hedges, and references
     that do not request a concrete change.
   - Number each actionable item internally and account for every item in the
     final `FEEDBACK_ACTIONS` block.

2. Research only what is needed.
   - Read the full contents of every file you intend to change.
   - Read matching tests when they exist.
   - Load external non-GitHub URLs with Playwright MCP when feedback or the PR
     body relies on them.
   - Use GitHub context from the prompt for issues, PRs, and private repo files
     instead of anonymous browser access.

3. Apply the minimum edit for each item.
   - Default to `fixed`.
   - Use `declined` only when the item is factually wrong or explicitly out of
     scope, and cite concrete evidence.
   - If the PR already satisfies stale feedback, mark it as already addressed
     with a specific file/line or earlier round.
   - Avoid unrelated refactors, renames, formatting churn, and type tightening.

4. Verify.
   - Call the configured verify tool before reporting success.
   - If verification fails, fix what this round introduced and retry within the
     allowed attempts.

## Final accounting

Every actionable item must appear as exactly one `FEEDBACK_ACTIONS` line.
Every edit in the diff must trace back to one of those items.
