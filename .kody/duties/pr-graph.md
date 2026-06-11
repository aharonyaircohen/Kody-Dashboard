---
every: 1h
staff: coo
stage: report-refresh
executables: pr-graph
reads_from: pr-graph
writes_to: pr-graph
---

# PR Graph

Refresh the pull request flow graph.

The report should show the current shape of PR work, including open/recent PRs, authors, labels, branches, checks, review state, stale PRs, and blocked PRs.
