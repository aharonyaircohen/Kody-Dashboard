Review PR #{{pr.number}} and write one structured review comment. Do not edit files or run git/gh write commands.

Use the `code-review` skill.

# PR #{{pr.number}}: {{pr.title}}

Base: {{pr.baseRefName}} <- Head: {{pr.headRefName}}

{{pr.body}}

{{conventionsBlock}}

# Diff

```diff
{{prDiff}}
```

# Run

- Follow the `code-review` skill.
- Use specialist reviewer subagents in parallel as described by the skill.
- Read only.
- Do not invent citations or pass blocked reviewer dimensions as clean.

# Final response (required)

Return exactly the raw markdown review comment defined in the `code-review`
skill. Do not wrap it in `DONE`, `COMMIT_MSG`, or `PR_SUMMARY`.
