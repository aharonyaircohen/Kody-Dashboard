Apply the feedback below to the existing PR branch `{{branch}}`, which is already checked out. The wrapper handles git/gh.

Use the `feedback-application` skill for extracting, applying, and accounting
for feedback items.

# Repo

- {{repoOwner}}/{{repoName}}, default branch: {{defaultBranch}}

# PR #{{pr.number}}: {{pr.title}}

{{pr.body}}

# Feedback to address (AUTHORITATIVE — supersedes the original issue spec)

{{feedback}}

{{conventionsBlock}}{{coverageBlock}}{{toolsUsage}}# Existing PR diff (current state, truncated)

```diff
{{prDiff}}
```

# Prior art (closed/merged PRs that previously attempted this work, if any)

{{priorArt}}

If a prior-art block is present above, scan it before editing — those are earlier attempts (possibly by you, possibly by a human) at the same fix. Note what was rejected and why; do not repeat a discarded approach.

{{memoryContext}}

# Run

- Follow the `feedback-application` skill.
- Treat the feedback as the scope and the authority for this fix round.
- Use Playwright MCP for external non-GitHub URLs when the feedback relies on them.
- Call the verify tool before reporting success.

# Boundaries

- Do not make unrelated refactors, renames, formatting churn, or type tightening.
- Do not run git/gh; the wrapper handles repository operations.
- Stay on `{{branch}}`.
- Do not modify forbidden/generated paths unless the feedback explicitly requires it.
- If the feedback is ambiguous or conflicts with the issue, prefer the feedback.
  {{systemPromptAppend}}

# Final message format (required)

Your FINAL message must use this exact format, with nothing before it. The
`FEEDBACK_ACTIONS:` block is required and must include one line per extracted
item.

```
DONE
FEEDBACK_ACTIONS:
- Item 1: "<short restatement of the item>" — <fixed: <what you edited> | declined: <specific reason>>
- Item 2: "<short restatement>" — <fixed: ... | declined: ...>
COMMIT_MSG: <conventional-commit message for this round of fixes>
PR_SUMMARY:
<2-4 bullets describing what changed in THIS fix round — not the whole PR>
```

If you cannot complete the task, output a single line instead: `FAILED: <reason>`.
