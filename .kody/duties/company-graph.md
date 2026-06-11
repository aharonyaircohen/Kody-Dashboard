---
every: manual
staff: coo
stage: report-refresh
executables: company-graph
reads_from: orchestration-conventions, company-graph
writes_to: company-graph
---

# Company Graph - derive and refresh the orchestration graph

## Job

Refresh the machine-readable graph of context, duties, staff, executables, reports, goals, and issue edges.

## Executable

Run the `company-graph` executable. Its skill owns the detailed method and runtime state handling.

## Output

Refresh `.kody/reports/company-graph.md`.

## Allowed Commands

- Run the `company-graph` executable.

## Restrictions

- Read-only on the working tree.
- Only write the company graph report.
- Do not post comments, labels, PRs, or inbox messages.
- Do not summarize file prose; derive structure.
