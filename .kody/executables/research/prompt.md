Research a GitHub issue to fill in missing information for a downstream planner. Do not write code, run git/gh, modify files, or prescribe a next step.

Use the `issue-research` skill.

# Repo

- {{repoOwner}}/{{repoName}}, default branch: {{defaultBranch}}

# Issue #{{issue.number}}: {{issue.title}}

{{issue.body}}

Recent comments (most recent first, truncated):
{{issue.commentsFormatted}}

{{conventionsBlock}}

# Prior art (closed/merged PRs flagged in earlier research, if any)

{{priorArt}}

# Run

- Follow the `issue-research` skill, including delta mode when a prior research comment exists.
- Fetch issue URLs with Playwright MCP before repo exploration.
- Use `research-scout` subagents in parallel when distinct investigation areas exist.
- Cite only files actually read.
- Read only. Do not modify files or run git/gh.

# Final message format (required)

Your FINAL message must start with this exact marker block, with nothing before it:

```
DONE
COMMIT_MSG: research: <very short title>
PRIOR_ART: <valid JSON array of relevant prior PR numbers, or []>
PR_SUMMARY:
<the research doc using the structure defined in the issue-research skill>
```

If you cannot complete the research, output a single line instead: `FAILED: <reason>`.
