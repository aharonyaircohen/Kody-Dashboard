Make a small chore, docs, or dependency-bump change end-to-end in ONE session. Keep investigation light, make the change correctly, verify it, and summarize. The wrapper handles git/gh.

Use the `chore-session` skill for the chore workflow.

# Repo

- {{repoOwner}}/{{repoName}}, default branch: {{defaultBranch}}
- current branch (already checked out): {{branch}}

{{conventionsBlock}}{{coverageBlock}}{{toolsUsage}}# Issue #{{issue.number}}: {{issue.title}}
{{issue.body}}

# Recent comments (most recent first, truncated)

{{issue.commentsFormatted}}

Comments posted **after** the issue body are clarifications, scope changes, and answers to questions — they are part of the specification and OVERRIDE the original body wherever they conflict. The trigger comment itself may add or narrow scope; obey it. Read every comment above before changing anything.

{{memoryContext}}

# Run

- Follow the `chore-session` skill.
- Treat issue comments as authoritative over the original body when they conflict.
- Call the verify tool before reporting success.

# Boundaries

- Stay inside the chore scope; do not make speculative adjacent cleanup.
- Do not run git/gh or post comments; the wrapper handles those operations.
- Stay on `{{branch}}`.
- Do not modify forbidden/generated paths unless the chore explicitly requires it.
- Treat unrelated pre-existing gate failures as out of scope unless your edits touched related behavior.
  {{systemPromptAppend}}

# Final message format (required)

Your FINAL message must use this exact format, with nothing before it:

```
DONE
COMMIT_MSG: <conventional-commit message, e.g. "chore: bump X to 1.2.3" or "docs: clarify Y">
PR_SUMMARY:
<2-6 short bullet points naming exactly what you changed (files, version numbers, doc sections), plus any URL you could not fetch or any code change you left untested (with the reason). No marketing fluff. No restating the issue.>
```

If you cannot complete the task, output a single line instead: `FAILED: <reason>`.
