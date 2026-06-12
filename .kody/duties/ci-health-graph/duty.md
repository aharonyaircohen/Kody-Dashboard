# CI Health Graph - refresh CI health map

## Job

Refresh the graph of workflows, recent runs, open PR checks, and CI blockers.

## Executable

Run the `ci-health-graph` executable.

## Output

Refresh `.kody/reports/ci-health-graph.md`.

## Allowed Commands

- Run the `ci-health-graph` executable.

## Restrictions

- Read-only on the working tree.
- Only write the CI health graph report.
- Do not post comments, labels, PRs, or inbox messages.
- Do not retry workflows or change branch protection.
