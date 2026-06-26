# Kody capability contracts

A **capability** is a reusable way the agency can produce a result. The canonical
storage is `.kody/capabilities/<slug>/profile.json` plus `capability.md`.
For the canonical model, see [`concepts/company-model.md`](concepts/company-model.md).

Capabilities are stored as one folder:

```text
.kody/capabilities/<slug>/
  profile.json
  capability.md
```

Kody chat creates capabilities with `create_or_update_capability`.

New UI/API work should create capabilities directly. The capability only defines what can be run.
Detailed execution mechanics belong in the executable.

## What a capability contract owns

A capability contract owns:

- **Action name**: the public `@kody <action>` token that runs this capability.
- **Kind**: `observe`, `act`, or `verify`.
- **Purpose**: what reusable ability it provides.
- **Cadence**: when this capability may run, if it is scheduled.
- **Agent**: which agent identity should run it.
- **Reviewer**: which agent identity should treat the output after it exists.
- **Output**: whether the capability only runs, or writes a report.
- **Safety rules**: what it may and may not do.
- **Executable link**: the implementation executable, when the capability needs one.

A capability contract does **not** own:

- A long agent identity prompt. Put that in `.kody/agents/<slug>.md`.
- A reusable action implementation. Put that in `.kody/executables/<slug>/`.
- A company reason or priority. Put that in Intent.
- Long-term progress. Put that in Goal.
- A long step-by-step runbook. Put reusable method in executable skills.
- Bash, Python, or API recipes. Put deterministic work in executable-owned
  scripts, or method details in executable skills.
- Raw state keys. Runtime state is engine-owned and not part of the capability
  authoring surface.

## Folder shape

Use this shape:

```text
.kody/capabilities/broken-links/
  profile.json
  capability.md
```

`profile.json` stores machine-readable metadata:

```json
{
  "name": "broken-links",
  "describe": "Broken link report",
  "action": "broken-links",
  "executable": "broken-link-report",
  "capabilityKind": "observe",
  "every": "1d",
  "agent": "qa",
  "reviewer": "cto",
  "writesTo": ["broken-link-report"]
}
```

`capability.md` stores the human-readable purpose and limits:

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

Do not put metadata frontmatter in `capability.md`. Metadata belongs in
`profile.json`; prose belongs in `capability.md`.

## Profile fields

| Field         | Meaning                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `name`        | Capability slug. Must match the folder name.                                                           |
| `describe`    | Human-readable title shown in the dashboard.                                                     |
| `action`      | Public action token. `@kody <action>` runs this capability. Usually the capability slug.                     |
| `executable`  | Optional implementation executable slug. Use this for the one executable that performs the work. |
| `capabilityKind` | Capability kind: `observe`, `act`, or `verify`. |
| `every`       | Optional cadence: `manual`, `1h`, `1d`, `7d`, etc.                                               |
| `agent`      | Agent identity slug that performs the capability. A capability without an agent should not auto-run.          |
| `reviewer`    | Optional agent identity slug responsible for reviewing or handling the capability output.               |
| `mentions`    | Optional GitHub logins to notify, without `@`.                                                   |
| `executables` | Multi-run executable list. Prefer singular `executable` for normal capabilities.                       |
| `tools`       | Optional capability tool names exposed to the tick agent.                                             |
| `tickScript`  | Optional deterministic script path for a scripted capability agent.                                   |
| `readsFrom`   | Context, report, or capability slugs this capability reads.                                                  |
| `writesTo`    | Report or context slugs this capability writes.                                                        |
| `disabled`    | `true` pauses autonomous scheduling.                                                             |

## Output choice

The dashboard creation form has two output choices:

| Choice   | Meaning                                                                    |
| -------- | -------------------------------------------------------------------------- |
| `Run`    | The capability runs work and does not promise a generated report.                |
| `Report` | The capability refreshes one `.kody/reports/<slug>.md` file and sets `writesTo`. |

Use `Report` only when the report file is the durable artifact users should
read later. Use `Run` for checks, dispatches, comments, or any capability whose proof
is activity/state rather than a report file.

## Body sections

### `## Job`

Say the capability's actual job in plain language.

Good:

```md
Find stale open PRs and create a weekly report.
```

Bad:

```md
You are a senior engineering manager...
```

### `## Executable`

For executable-backed capabilities, name the executable and explain what outcome it
must produce. Keep the implementation details in the executable folder.

### `## Allowed Commands`

For executable-backed capabilities, list only the executable.

Keep shell commands, API calls, and long run logic out of the capability. They belong
in executable skills or executable-owned scripts.

### `## Restrictions`

List hard limits.

Examples:

- Do not push branches.
- Do not comment on PRs.
- Do not edit source files.
- Only update `.kody/reports/<slug>.md`.

## Choosing between capability, executable, and agent

Use a **Capability** when the agency needs a reusable ability, especially one
that is recurring or public as an `@kody <action>`.

Use an **executable** when you are defining implementation that a capability
can run, such as a deterministic graph refresh or an agent workflow.

Use **agent** when you are defining who performs the work.

## Creation checklist

Before creating a capability contract, Kody should know:

- What should happen.
- Whether it is `observe`, `act`, or `verify`.
- Which public action runs it. Usually this should match the slug.
- How often it should happen.
- Which agent is the agent.
- Which agent is the reviewer, if anyone.
- Whether the output is `Run` or `Report`.
- Which implementation executable runs the work, if needed.
- Which reports or context entries it reads or writes, if any.
- Which actions are forbidden.

If any of those are unclear, Kody should ask before creating the capability.
