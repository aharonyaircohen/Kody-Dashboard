---
agent: ["*"]
---

# Dependency Graph Context

The dependency graph report lives at `.kody/reports/dependency-graph.md` on the `kody-state` branch.

Use it to understand repo dependency structure:

- package manifests and lockfiles
- production, development, peer, and optional dependencies
- dependency version conflicts across packages
- risky dependency ranges and missing lockfile coverage

The graph is a state report. It should be refreshed by its duty and read by agents before dependency upgrades, CI fixes, or security work.
