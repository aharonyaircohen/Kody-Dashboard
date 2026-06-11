---
name: company-graph
description: Derive the Kody company graph from repo-owned .kody files and report structural gaps.
---

# Company Graph Skill

Use this skill when refreshing `.kody/reports/company-graph.md`.

## Model

Build graph nodes for:

- context files
- duties
- staff
- executables
- scripts
- skills
- reports
- goals
- goal-labelled issues

Build graph edges for:

- duty `staff` -> assigned staff
- duty `executables` -> runnable executable
- duty `reads_from` -> source context/report/duty
- duty `writes_to` -> report
- context `staff` -> audience staff
- executable configured skills -> skill nodes
- executable preflight scripts -> script nodes
- issue `goal:*` labels -> goal nodes

## Findings

Report:

- graph snapshot counts and hash
- orphan staff
- stale context
- disabled duties referenced by other duties
- `.kody/` coverage gaps
- GitHub rate-limit skips

## Boundaries

- Write only `.kody/reports/company-graph.md`.
- Do not edit the working tree.
- Do not run `git`.
- Do not post comments, labels, PRs, or inbox pings.
- Extract structure only; do not summarize prose.
