---
agent: [*]
---

# CI Health Graph

The CI health graph shows whether repo automation is healthy.

The live graph data is written to `.kody/reports/ci-health-graph.md`.

## What It Shows

- Workflows
- Recent workflow runs
- Branches
- Open PRs
- PR checks
- Failure and blocker edges

## How To Use It

Use it to decide what CI problem Kody should fix first.

Look for:

- repeated workflow failures
- flaky workflows
- PRs blocked by failing checks
- slow or stale automation signals

## Boundaries

This graph is generated data.

Do not edit the report by hand. Fix the workflow, PR, or source problem, then
refresh the graph.
