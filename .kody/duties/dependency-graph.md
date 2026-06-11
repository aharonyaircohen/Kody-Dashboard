---
every: 1d
staff: cto
stage: report-refresh
executables: dependency-graph
reads_from: dependency-graph
writes_to: dependency-graph
---

# Dependency Graph

Refresh the dependency graph.

The report should show package manifests, lockfiles, dependency declarations, risky ranges, and version conflicts that can affect delivery, security, or upgrade work.
