# Kody duties

A **duty** is recurring work Kody can schedule, display, and run.

A duty is stored as one folder:

```text
.kody/duties/<slug>/
  profile.json
  duty.md
```

Kody chat can create one too. It must first read this guide, then use the
`create_or_update_kody_duty` tool — same tool handles both creating a new
duty and patching an existing one (omit a field to preserve it; pass `body`
to replace the markdown).

## What a duty owns

A duty owns:

- **Action name**: the public `@kody <action>` token that runs this duty.
- **Purpose**: why the work exists and what outcome it maintains.
- **Cadence**: how often the scheduler may run it.
- **Agent**: which agent identity should run it.
- **Reviewer**: which agent identity should treat the output after it exists.
- **Output**: whether the duty only runs, or writes a report.
- **Safety rules**: what it may and may not do.
- **Executable link**: the implementation executable, when the duty needs one.

A duty does **not** own:

- A long agent identity prompt. Put that in `.kody/agents/<slug>.md`.
- A reusable action implementation. Put that in `.kody/executables/<slug>/`.
- A long step-by-step runbook. Put reusable method in executable skills.
- Bash, Python, or API recipes. Put deterministic work in executable-owned
  scripts, or method details in executable skills.
- Raw state keys. Runtime state is engine-owned and not part of the duty
  authoring surface.

## Folder shape

Use this shape:

```text
.kody/duties/broken-links/
  profile.json
  duty.md
```

`profile.json` stores machine-readable metadata:

```json
{
  "name": "broken-links",
  "describe": "Broken link report",
  "action": "broken-links",
  "executable": "broken-link-report",
  "every": "1d",
  "agent": "qa",
  "reviewer": "cto",
  "writesTo": ["broken-link-report"]
}
```

`duty.md` stores the human-readable purpose and limits:

```md
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

Do not put metadata frontmatter in `duty.md`. Metadata belongs in
`profile.json`; prose belongs in `duty.md`.

## Profile fields

| Field         | Meaning                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `name`        | Duty slug. Must match the folder name.                                                           |
| `describe`    | Human-readable title shown in the dashboard.                                                     |
| `action`      | Public action token. `@kody <action>` runs this duty. Usually the duty slug.                     |
| `executable`  | Optional implementation executable slug. Use this for the one executable that performs the work. |
| `every`       | Optional cadence: `manual`, `1h`, `1d`, `7d`, etc.                                               |
| `agent`      | Agent identity slug that performs the duty. A duty without an agent should not auto-run.          |
| `reviewer`    | Optional agent identity slug responsible for reviewing or handling the duty output.               |
| `mentions`    | Optional GitHub logins to notify, without `@`.                                                   |
| `executables` | Multi-run executable list. Prefer singular `executable` for normal duties.                       |
| `tools`       | Optional duty tool names exposed to the tick agent.                                             |
| `tickScript`  | Optional deterministic script path for a scripted duty agent.                                   |
| `readsFrom`   | Context, report, or duty slugs this duty reads.                                                  |
| `writesTo`    | Report or context slugs this duty writes.                                                        |
| `disabled`    | `true` pauses autonomous scheduling.                                                             |

## Output choice

The dashboard creation form has two output choices:

| Choice   | Meaning                                                                    |
| -------- | -------------------------------------------------------------------------- |
| `Run`    | The duty runs work and does not promise a generated report.                |
| `Report` | The duty refreshes one `.kody/reports/<slug>.md` file and sets `writesTo`. |

Use `Report` only when the report file is the durable artifact users should
read later. Use `Run` for checks, dispatches, comments, or any duty whose proof
is activity/state rather than a report file.

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

### `## Executable`

For executable-backed duties, name the executable and explain what outcome it
must produce. Keep the implementation details in the executable folder.

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

## Choosing between duty, executable, and agent

Use a **duty** when the work is recurring or public as an `@kody <action>`.

Use an **executable** when you are defining implementation that a duty action
can run, such as a deterministic graph refresh or an agent workflow.

Use **agent** when you are defining who performs the work.

## Creation checklist

Before creating a duty, Kody should know:

- What should happen.
- Which public action runs it. Usually this should match the slug.
- How often it should happen.
- Which agent is the agent.
- Which agent is the reviewer, if anyone.
- Whether the output is `Run` or `Report`.
- Which implementation executable runs the work, if needed.
- Which reports or context entries it reads or writes, if any.
- Which actions are forbidden.

If any of those are unclear, Kody should ask before creating the duty.
