Classify the issue below into exactly one flow type.

Use the `issue-classification` skill.

# Repo

{{repoOwner}}/{{repoName}}, default branch `{{defaultBranch}}`

# Issue #{{issue.number}}: {{issue.title}}

Labels: {{issue.labelsFormatted}}

{{issue.body}}

Recent comments (most recent first, truncated):
{{issue.commentsFormatted}}

{{conventionsBlock}}

# Run

- Follow the `issue-classification` skill.
- Pick exactly one of `feature`, `bug`, `spec`, or `chore`.
- Treat issue body and comments as authoritative over labels when they conflict.
- Read only. Do not modify files or run git/gh.

# Final message format (required)

Your FINAL message must use this exact format, with nothing before it:

```
DONE
COMMIT_MSG: classify: <classification>
PR_SUMMARY:
classification: <feature|bug|spec|chore>
reason: <one sentence explaining the pick, grounded in the issue text>
```

If you cannot complete the task, output a single line instead: `FAILED: <reason>`.
