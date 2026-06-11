# Issue Research

Use this skill to research an issue for a downstream planner without prescribing
the implementation.

## Workflow

1. Fetch external references first.
   - Scan the issue and comments for every URL.
   - Use Playwright MCP to load each one.
   - Summarize what was actually visible, or state why it could not be loaded.

2. Check for delta mode.
   - If a previous research comment exists, report only answered questions,
     still-open questions, new gaps, and changed scope.
   - If nothing changed since the prior research, fail instead of duplicating.

3. Investigate the repo.
   - Use `research-scout` subagents in parallel for distinct areas when useful.
   - Read files before citing them.
   - Surface only issue-specific modules, patterns, constraints, and prior-art
     outcomes.

4. Write findings, not a plan.
   - Restate the understood request.
   - Summarize external references.
   - Cite repo context with real paths.
   - Ask clarifying questions only when the answer changes implementation.
   - Separate gaps, assumptions, in-scope work, and out-of-scope adjacent work.

## Required research sections

For first-pass research, `PR_SUMMARY` must include:

- `## Understood request`
- `## External references`
- `## Repo context`
- `## Clarifying questions`
- `## Gaps & assumptions`
- `## Proposed scope`

For delta mode, `PR_SUMMARY` must include:

- `## Delta since last research`
- `## Updated scope` when materially changed

## Boundaries

- Read only.
- Do not write code, modify files, run git, or run gh.
- Do not propose a next step or implementation plan.
- Do not invent citations or summarize unfetched URLs.
