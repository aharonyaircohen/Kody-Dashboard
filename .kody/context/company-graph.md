---
staff: [*]
---

# Company Graph

The company graph is the generated map of Kody's orchestration surface.

The live graph data is written to `.kody/reports/company-graph.md`.

## What It Shows

- Staff
- Duties
- Executables
- Skills
- Scripts
- Reports
- Context files
- Goal-labelled issues

## How To Use It

Use the graph when you need to understand how Kody work is wired together.

Read nodes as things that exist. Read edges as relationships between them.

Common edges:

- `assigned_to`: duty to staff
- `runs`: duty to executable
- `reads_from`: duty to context or report
- `writes_to`: duty to report
- `uses_skill`: executable to skill
- `runs_preflight`: executable to script

## Boundaries

The graph is generated data, not a source of truth.

Do not edit the report by hand. Change the source `.kody/` files, then refresh
the graph.

Do not put runtime cursors or last-run timestamps here. Engine state is hidden.
