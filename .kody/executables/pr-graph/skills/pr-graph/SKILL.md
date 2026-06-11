---
name: pr-graph
description: Derive pull request flow from GitHub PR metadata.
---

# PR Graph Skill

Use this skill when refreshing `.kody/reports/pr-graph.md`.

## Model

Build graph nodes for:

- pull requests
- authors
- base and head branches
- labels
- checks

Build graph edges for:

- PR to author
- PR to base branch
- PR to head branch
- PR to labels
- PR to checks

## Findings

Report:

- graph snapshot counts and hash
- stale open PRs
- stale draft PRs
- open PRs with non-green checks
- open PRs without checks
- open PRs that need review
- open PRs without clear issue linkage

## Boundaries

- Write only `.kody/reports/pr-graph.md`.
- Do not edit the working tree.
- Do not merge, close, label, comment on, or review PRs.
