---
every: manual
staff: coo
executables: repo-graph
---

# Repo Graph — derive and refresh the orchestration graph

## Job

Refresh a machine-readable graph of the repo's orchestration surface: context,
duties, staff, executables, goals, reports, and the issue edges attached to
them.

The graph is written to `.kody/reports/repo-graph.md`. Chat and other duties can
read that report instead of walking `.kody/` every time.

This duty owns the purpose, schedule, staff assignment, and safety limits. The
mechanical derivation and report write live in the `repo-graph` executable.

The report should show:

- a snapshot count for each node type
- orphan staff
- stale context
- disabled-but-referenced duties
- `.kody/` coverage gaps
- rate-limit skips, when the executable cannot safely refresh

## Allowed Commands

- Run the `repo-graph` executable.

## Restrictions

- Read-only on the working tree.
- The only repo write is `.kody/reports/repo-graph.md`.
- No issue comments, inbox pings, PRs, labels, or task dispatches.
- No LLM summaries of file contents. The graph is structured data, not prose.
- Quiet on success: no comments, no inbox pings, no PRs, no labels. The report file is the only output.

## State

- `cursor`: `idle` | `producing` | `error`
- `data.lastRunISO`: ISO timestamp of the last tick that ran
- `data.lastReportISO`: ISO timestamp of the last successful report write
- `data.findingCount`: count of findings in the last report (informational)
- `done`: always `false`
