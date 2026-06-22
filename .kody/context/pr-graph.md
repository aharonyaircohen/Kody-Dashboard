---
agent: ["*"]
---

# PR Graph Context

The PR graph report lives at `.kody/reports/pr-graph.md` on the `kody-state` branch.

Use it to understand pull request flow:

- open and recent PRs
- authors, labels, branches, review state, and checks
- stale PRs, blocked checks, missing review, and weak issue linkage

The graph is a state report. Duties and agents should read it when deciding where delivery flow is blocked, but they should not hand-edit the report.
