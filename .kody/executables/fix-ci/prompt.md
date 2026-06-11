A CI workflow on PR #{{pr.number}} (`{{branch}}`) is failing. Read the failed-step log below and fix the root cause. The wrapper handles git/gh.

Use the `ci-repair` skill for classifying and repairing the failure.

# Repo

- {{repoOwner}}/{{repoName}}, default branch: {{defaultBranch}}

# PR #{{pr.number}}: {{pr.title}}

# Failing workflow

- Workflow: {{failedWorkflowName}}
- Run URL: {{failedRunUrl}}

# Failed-step log (truncated, most recent ~30KB)

```
{{failedLogTail}}
```

{{conventionsBlock}}{{toolsUsage}}# Current PR diff (truncated)

```diff
{{prDiff}}
```

# Run

- Follow the `ci-repair` skill.
- Fix the root cause, not just the symptom in the log.
- Call the verify tool before reporting success.

# Boundaries

- Do not hide failures with suppressions, skipped tests, weaker assertions, retries, or disabled CI steps.
- Do not bundle unrelated cleanup into a CI fix.
- Do not run git/gh; the wrapper handles repository operations.
- Stay on `{{branch}}`.
  {{systemPromptAppend}}

# Final message format (required)

Your FINAL message must use this exact format, with nothing before it:

```
DONE
COMMIT_MSG: fix(ci): <short root-cause description>
PR_SUMMARY:
<2-4 bullets: what was failing, what you changed, why it fixes it>
```

If you cannot complete the task, output a single line instead: `FAILED: <reason>`.
