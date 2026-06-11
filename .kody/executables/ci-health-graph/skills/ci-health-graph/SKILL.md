---
name: ci-health-graph
description: Derive CI health from workflow runs and PR checks.
---

# CI Health Graph Skill

Use this skill when refreshing `.kody/reports/ci-health-graph.md`.

## Model

Build graph nodes for:

- workflows
- workflow runs
- branches
- open PRs
- PR checks

Build graph edges for:

- workflow to run
- run to branch
- PR to branch
- PR to check

## Findings

Report:

- graph snapshot counts and hash
- workflows whose latest run failed
- workflows that look flaky
- open PRs blocked by CI
- missing run/check data

## Boundaries

- Write only `.kody/reports/ci-health-graph.md`.
- Do not edit the working tree.
- Do not retry workflows.
- Do not post comments, labels, PRs, or inbox pings.
