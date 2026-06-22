---
agent: ["*"]
---

# Reports

Reports are generated state files on the `kody-state` branch under `.kody/reports/`.

Use this index to choose which report to read:

- `company-graph`: Kody structure, duties, agent, executables, skills, and context links.
- `ci-health-graph`: GitHub Actions runs, PR checks, failing workflows, and CI blockers.
- `pr-graph`: PR flow, review state, labels, branches, stale PRs, and blocked PRs.
- `dependency-graph`: package manifests, lockfiles, dependency ranges, and version conflicts.
- `docs-graph`: markdown docs, links, broken local links, missing headings, and TODO markers.
- `memory-compaction`: memory footprint, task recommendation backlog, and safe compaction proposals.

Do not hand-edit reports. Refresh them through their matching duty.
