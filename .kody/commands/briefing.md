---
description: Summarize what needs attention across reports, tasks, reviews, running work, and waiting decisions.
---

Run the Work Briefing.

First call `read_executable` for slug `work-briefing` and follow its `work-briefing` skill. If it is not available, use the method below directly.

Use available read-only tools to gather current state:

- `list_reports`, then `read_report` for action-needed or recent reports
- `github_list_issues` for open tasks and waiting items
- `kody_list_open_prs` for PRs in review
- `kody_list_workflow_runs` for recent failures or running CI
- `list_inbox` for waiting decisions
- `list_goals` for active goals

Return the briefing in chat. Do not create, assign, close, edit, or solve anything.
