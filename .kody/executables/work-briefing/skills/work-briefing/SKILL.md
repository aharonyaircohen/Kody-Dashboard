---
name: work-briefing
description: Summarize reports, tasks, reviews, running work, waiting items, and failures into a prioritized briefing.
---

# Work Briefing Skill

Use this skill when the user asks what is on the table, asks for a briefing, runs `/briefing`, or the `work-briefing` executable runs.

## Method

Gather the current state, then sort by importance.

Read:

- action-needed and recent reports
- open issues and tasks
- open pull requests
- recent workflow runs or failed checks
- inbox or waiting decisions
- active goals, when available
- running or stuck Kody sessions, when available

## Priority Order

1. Urgent: failing production, broken CI, blocked delivery, high-severity reports.
2. Needs decision: waiting reviews, action-needed reports, approval gates, unclear ownership.
3. In progress: running work, open PRs, active goals with current tasks.
4. Can wait: low-severity reports, stale but harmless cleanup, background chores.

## Output

Return a short briefing with these sections:

- Urgent
- Needs decision
- In progress
- Can wait
- Suggested next actions

Each item should say what it is, why it matters, and the next action.

## Restrictions

- Do not create tasks.
- Do not assign staff.
- Do not close issues.
- Do not edit reports.
- Do not solve findings.
- Prefer links and ids over long explanations.
- If a data source is unavailable, say that briefly and continue.
