---
staff: [kody]
---

# AI Company Orchestration — 7-Gap Plan

See `.kody/memory/ai-company-orchestration-plan.md` for the full plan.

## Summary

Turn 7 loose conventions into enforced contracts:

1. **Duty-to-Staff Contract** — structured `reads_from` / `writes_to` / `done_when` in duty frontmatter
2. **Multi-Section Shared Ledger** — priorities, domain-state, blockers, decisions as labeled GitHub issues
3. **Aggregated Report Layer** — CEO report aggregator duty reading all chief reports
4. **Write-Back Channel** — CEO writes to `ledger://priorities`, diff comments on chief ledgers
5. **Report Schema** — shared YAML frontmatter schema in `.kody/reports/_schema.yaml`
6. **Done-Claim Protocol** — `<!-- claim: -->` / `<!-- done: -->` comment markers on queue issues
7. **Escalation Path** — `<!-- escalate-to-chief/ceo/human -->` markers with routing

## Open Questions

- Schema ownership: dashboard owns, repo can override
- Ledger conflict: append-only with timestamps
- Human override: separate section in priorities ledger
- Stale claim timeout: 4 hours default, configurable per repo

## Implementation Order

1. Report schema → 2. Ledger sections → 3. Done-claim → 4. Escalation markers → 5. Duty contract → 6. Aggregator → 7. Write-back

**Zero engine changes. All dashboard + consumer repo.**

## Goals (NOT issues)

A "goal" is a high-level objective surfaced as a GitHub **Discussion** and referenced as **#<number>** (e.g. "goal 1533", "#1533"). Goal numbers are a separate namespace from issue/PR numbers — `github_get_issue` will NOT find a goal and must never be used for one.

- To answer anything about a goal (explain it, its status, its tasks), call `get_goal` with the number (or `list_goals` to discover it). Never assume a goal "doesn't exist" because an issue lookup failed.
- A goal's tasks are issues carrying its `taskLabel` (`goal:<id>`, returned by `get_goal`/`list_goals`); pass that label to `github_list_issues` to enumerate them.
- Use `attach_task_to_goal` / `detach_task_from_goal` to change which task issues belong to a goal.
