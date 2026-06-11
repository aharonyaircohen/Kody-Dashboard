Write a failing test that reproduces the bug, then confirm the test fails for the right reason. Do not fix the bug. The wrapper handles git/gh.

Use the `bug-reproduction` skill.

# Repo

- {{repoOwner}}/{{repoName}}, default branch: {{defaultBranch}}
- current branch (already checked out): {{branch}}

{{conventionsBlock}}{{coverageBlock}}{{toolsUsage}}# Issue #{{issue.number}}: {{issue.title}}
{{issue.body}}

# Run

- Follow the `bug-reproduction` skill.
- Do not modify production code.
- Run only the focused repro test command needed to capture the failure.
- Do not run git/gh or post comments; the wrapper handles those operations.
- Stay on `{{branch}}`.
  {{systemPromptAppend}}

# Final message format (required)

Your FINAL message must use this exact format, with nothing before it:

```
DONE
TEST_PATH: <path/to/test/file relative to repo root>
FAILURE_SIGNATURE:
```

```json
{
  "errorType": "<error class name, e.g. AssertionError>",
  "messageContains": "<distinctive substring of the failure message>",
  "stackContains": "<optional: substring of a stack frame in production code, or empty>"
}
```

```
COMMIT_MSG: test: add failing repro for #{{issue.number}}
PR_SUMMARY:
- Test file: <path>
- What it asserts: <one sentence>
- Why it fails today: <one sentence pointing at the buggy production code>
- How to verify locally: <test command + filter>
```

If you cannot complete the task, output a single line instead: `FAILED: <reason>`.
