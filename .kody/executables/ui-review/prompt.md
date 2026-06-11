Review PR #{{pr.number}} by reading the diff and browsing the running preview. Post one structured UI review comment. Do not edit tracked source files or run git/gh.

Use the `ui-review` skill.

You may write throwaway Playwright specs and screenshots under `.kody/ui-review/`.

# PR #{{pr.number}}: {{pr.title}}

Base: {{pr.baseRefName}} <- Head: {{pr.headRefName}}

{{pr.body}}

# Preview URL

`{{previewUrl}}` (resolved from: {{previewUrlSource}})

# QA context

```text
{{qaContext}}
```

# QA scenarios and notes

{{qaProfile}}

{{qaAuthBlock}}

{{#linkedFinding}}
# What this PR must deliver

Judge the verdict against whether the linked issue goal is met in the running
app, not merely whether the diff looks correct.

```text
{{linkedFinding}}
```
{{/linkedFinding}}

# Diff

```diff
{{prDiff}}
```

{{conventionsBlock}}

{{toolsUsage}}

# Run

- Follow the `ui-review` skill.
- Navigate to `{{previewUrl}}` with Playwright MCP before other browsing.
- Use a diff-only review when the preview is unreachable, and report that gap.
- Never write credentials in the review, findings, steps, or screenshots.
- Do not edit tracked source files or run git/gh.

# Final response (required)

Return exactly the raw markdown UI review comment defined in the `ui-review`
skill. Do not wrap it in `DONE`, `COMMIT_MSG`, or `PR_SUMMARY`.
