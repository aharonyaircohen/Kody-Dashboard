Fix a GitHub bug/enhancement issue end-to-end in ONE session: reproduce it with a failing test, research, plan, fix, verify, and summarize. The wrapper handles git/gh.

Use the `systematic-debugging` skill for the bug-fix workflow.

# Repo

- {{repoOwner}}/{{repoName}}, default branch: {{defaultBranch}}
- current branch (already checked out): {{branch}}

{{conventionsBlock}}{{coverageBlock}}{{toolsUsage}}# Issue #{{issue.number}}: {{issue.title}}
{{issue.body}}

# Recent comments (most recent first, truncated)

{{issue.commentsFormatted}}

Comments posted **after** the issue body are clarifications, scope changes, and answers to questions — they are part of the specification and OVERRIDE the original body wherever they conflict. The trigger comment itself may add or narrow scope; obey it. Read every comment above before planning.

# Prior art (closed/merged PRs that previously attempted this issue, if any)

{{priorArt}}

If a prior-art block is present above, READ THE DIFFS — those are failed or superseded attempts at this same bug. Identify what went wrong (review comments, the fact they were closed without merging, or behavioural gaps in the diff itself) and pick a different approach. Repeating a prior failed attempt is a hard failure even if your tests pass locally.

{{memoryContext}}

# Run

- Follow the `systematic-debugging` skill.
- Treat issue comments as authoritative over the original body when they conflict.
- If prior art exists, inspect the diffs and avoid repeating rejected approaches.
- Use codegraph before grep for symbol and call-path questions.
- Call the verify tool before reporting success.

# Boundaries

- Stay inside the bug scope; do not make speculative refactors or adjacent cleanups.
- Do not run git/gh or post comments; the wrapper handles those operations.
- Stay on `{{branch}}`.
- Do not modify forbidden/generated paths unless the issue explicitly requires it.
- Treat unrelated pre-existing gate failures as out of scope unless your edits touched related behavior.
  {{systemPromptAppend}}

# Final message format (required)

Your FINAL message must use this exact format, with nothing before it:

```
DONE
COMMIT_MSG: <conventional-commit message, e.g. "fix: handle empty input in X">
PR_SUMMARY:
<2-6 short bullet points: the repro test path + what it asserts, the root cause, the files/functions you changed, plus any URL you could not fetch. No marketing fluff. No restating the issue.>
```

If you cannot complete the task, output a single line instead: `FAILED: <reason>`.
