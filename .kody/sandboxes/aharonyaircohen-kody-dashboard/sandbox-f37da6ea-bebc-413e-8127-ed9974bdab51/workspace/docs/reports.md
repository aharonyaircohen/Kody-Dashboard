# Reports

Reports are the dashboard's review surface for duty output. A duty can either
act through its executable, or write a markdown report under
`.kody/reports/<slug>.md` on the `kody-state` branch when the next step needs
operator judgement.

The Reports page reads those files, shows the report body, tracks unread state
locally, and can render optional suggested actions from frontmatter. It replaces
the old inbox-approval/ledger review surface for recommendations.

## Report Shape

Every report is a markdown file with frontmatter:

```yaml
---
generatedAt: "2026-06-08T12:00:00Z"
dutySlug: qa-sweep
reviewStatus: action-needed
reviewArea: ci
findings:
  - id: failing-tests
    severity: high
    title: Unit tests are failing
suggestedActions:
  - id: fix-ci-42
    type: dispatch
    label: Run fix-ci on PR #42
    executable: fix-ci
    target: 42
    reason: The latest CI run failed on the PR head.
  - id: task-flaky-test
    type: create-task
    label: Create a task for the flaky test
    title: Fix flaky dashboard test
    labels: from-report,ci
---
# QA Sweep

The report body explains the finding and supporting evidence.
```

Required keys:

- `generatedAt`: ISO date-time for when the report was produced.
- `findings`: at least one finding with `id`, `severity`, and `title`.

Optional routing keys:

- `dutySlug`: the duty that produced the report.
- `reviewStatus`: `none`, `info`, `action-needed`, `assigned`, or `reviewed`.
- `reviewArea`: broad area for future report review/routing.
- `suggestedActions`: dashboard-rendered follow-up buttons.

## Suggested Actions

Suggested actions are recommendations embedded in the report. They are not an
approval ledger and they are not hidden engine commands. The report author
declares the action, the dashboard renders it, and the operator chooses whether
to use it.

Supported action types:

| Type | Required fields | What the dashboard does |
| --- | --- | --- |
| `dispatch` | `id`, `type`, `label`, `executable`, `target` | Runs an instant job for the named executable against the issue/PR number. |
| `create-task` | `id`, `type`, `label`, `title` | Opens the existing task dialog prefilled from the action and source report. |
| `dismiss` | `id`, `type`, `label` | Hides that suggested action locally for the current browser. |

Dispatch actions must name a real executable and a concrete issue/PR number.
The dashboard does not infer commands from prose.

Create-task actions can include:

- `body`: task body text.
- `labels`: comma-separated labels added alongside `from-report:<slug>`.

Dismiss is intentionally local. It is useful for clearing known noise from the
screen, but it does not write a verdict, trust score, or audit decision.

## Operating Model

Use reports when a duty has findings, context, or recommendations that a human
should review before follow-up work starts.

Use direct executable action when the executable already has a clear operation
and the required permissions. The duty itself does not write arbitrary state;
the executable owns what operations it can perform.

This keeps the loop simple:

1. Duty runs.
2. Executable either acts or writes/updates a report.
3. Operator reads the report.
4. Operator uses a suggested action, creates a task/goal, dispatches a job, or
   does nothing.

## Validation

The shared schema lives at `.kody/reports/_schema.yaml`.

Local validation is handled by:

```bash
pnpm exec node scripts/validate-reports.mjs .kody/reports
```

The parser and validator are covered by:

```bash
pnpm exec vitest run tests/unit/reports-files.spec.ts tests/unit/report-schema-validator.spec.ts
```

## Related Files

| File | Purpose |
| --- | --- |
| [ReportsView.tsx](../src/dashboard/lib/components/ReportsView.tsx) | Reports page, markdown rendering, suggested-action buttons. |
| [reports-files.ts](../src/dashboard/lib/reports-files.ts) | Reads report markdown from the state branch. |
| [report-suggested-actions.ts](../src/dashboard/lib/report-suggested-actions.ts) | Parses `suggestedActions` frontmatter. |
| [report-schema-validator.mjs](../scripts/report-schema-validator.mjs) | Validates report frontmatter in tests/scripts. |
| [_schema.yaml](../.kody/reports/_schema.yaml) | Human-readable report schema. |
