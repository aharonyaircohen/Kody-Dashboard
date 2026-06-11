# Kody duties

A **duty** is recurring work Kody checks on a schedule.

It is stored as one markdown file:

```text
.kody/duties/<slug>.md
```

Kody chat can create one too: it should first read this guide, then use the
`create_kody_duty` tool.

## What a duty owns

A duty owns:

- **Purpose**: what should be watched or maintained.
- **Cadence**: how often it is allowed to act.
- **Staff**: which staff persona should run it.
- **Progress type**: the simple stage template shown in the dashboard.
- **Safety rules**: what it may and may not do.
- **Executable link**: which executable performs the work.

A duty does **not** own:

- A long staff/persona prompt. Put that in `.kody/staff/<slug>.md`.
- A reusable action implementation. Put that in `.kody/executables/<slug>/`.
- A long step-by-step runbook. Put that in the executable skill.
- Bash, Python, or API recipes. Put deterministic work in executable-owned
  scripts, or method details in executable skills.
- Raw state keys. Runtime state is engine-owned and hidden behind the selected
  progress type.

## File shape

Use this shape:

```md
---
every: 1d
staff: qa
stage: report-refresh
executables: broken-link-report
---
# Broken link report

## Job

Check the docs for broken links and refresh the report.

## Executable

Run the `broken-link-report` executable. Its skill owns the detailed method and
runtime state handling.

## Output

Refresh `.kody/reports/broken-link-report.md`.

## Allowed Commands

- Run the `broken-link-report` executable.

## Restrictions

- Do not edit source files.
- Only update the generated report.
```

## Frontmatter

| Field | Meaning |
| --- | --- |
| `every` | Optional cadence: `manual`, `1h`, `1d`, `7d`, etc. |
| `staff` | Staff persona slug. A duty without staff should not auto-run. |
| `stage` | Progress type. Use one of the built-in templates below. |
| `mentions` | Optional GitHub logins to notify. |
| `executables` | Optional executable slugs the duty may dispatch or depend on. |
| `disabled` | `true` pauses the duty. |

## Progress types

| Stage | Use when |
| --- | --- |
| `simple-check` | The duty runs and finishes. |
| `report-refresh` | The duty updates a report or result file. |
| `sweep` | The duty scans many things and records findings. |
| `approval-gate` | The duty waits for review, then approves or blocks. |
| `review-loop` | The duty reviews items again and again over time. |

## Body sections

### `## Job`

Say the duty's actual job in plain language.

Good:

```md
Find stale open PRs and create a weekly report.
```

Bad:

```md
You are a senior engineering manager...
```

### `## Allowed Commands`

For executable-backed duties, list only the executable.

Keep shell commands, API calls, and long run logic out of the duty. They belong
in executable skills or executable-owned scripts.

### `## Restrictions`

List hard limits.

Examples:

- Do not push branches.
- Do not comment on PRs.
- Do not edit source files.
- Only update `.kody/reports/<slug>.md`.

## Choosing between duty, executable, and staff

Use a **duty** when the work is recurring.

Use an **executable** when you are defining an action someone can run, like
`@kody refresh-graph`.

Use **staff** when you are defining who performs the work.

## Creation checklist

Before creating a duty, Kody should know:

- What should happen.
- How often it should happen.
- Which staff member runs it.
- Which progress type fits.
- Which executable runs the work.
- Which actions are forbidden.

If any of those are unclear, Kody should ask before creating the duty.
