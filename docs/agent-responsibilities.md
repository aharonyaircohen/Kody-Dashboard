# Kody capability contracts

A **Capability** is how the agency can produce a result. The canonical storage
is now `.kody/capabilities/<slug>/profile.json` plus `capability.md`. The
legacy storage name for a capability contract is **agentResponsibility**. For
the canonical model, see [`concepts/company-model.md`](concepts/company-model.md).

Legacy capability contracts are stored as one agentResponsibility folder:

```text
.kody/agent-responsibilities/<slug>/
  profile.json
  agent-responsibility.md
```

Kody chat can create one too. It must first read this guide, then use the
`create_or_update_agent_responsibility` tool — same tool handles both creating a new
agentResponsibility and patching an existing one (omit a field to preserve it; pass `body`
to replace the markdown).

New UI/API work should create capabilities, not agentResponsibilities. The
engine still reads agentResponsibilities as a fallback while old repos migrate.

## What a capability contract owns

A capability contract owns:

- **Action name**: the public `@kody <action>` token that runs this agentResponsibility.
- **Kind**: `observe`, `act`, or `verify`.
- **Purpose**: what reusable ability it provides.
- **Cadence**: when this capability may run, if it is scheduled.
- **Agent**: which agent identity should run it.
- **Reviewer**: which agent identity should treat the output after it exists.
- **Output**: whether the agentResponsibility only runs, or writes a report.
- **Safety rules**: what it may and may not do.
- **AgentAction link**: the implementation agentAction, when the agentResponsibility needs one.

A capability contract does **not** own:

- A long agent identity prompt. Put that in `.kody/agents/<slug>.md`.
- A reusable action implementation. Put that in `.kody/agent-actions/<slug>/`.
- A company reason or priority. Put that in Intent.
- Long-term progress. Put that in Goal.
- A long step-by-step runbook. Put reusable method in agentAction skills.
- Bash, Python, or API recipes. Put deterministic work in agentAction-owned
  scripts, or method details in agentAction skills.
- Raw state keys. Runtime state is engine-owned and not part of the agentResponsibility
  authoring surface.

## Folder shape

Use this shape:

```text
.kody/agent-responsibilities/broken-links/
  profile.json
  agent-responsibility.md
```

`profile.json` stores machine-readable metadata:

```json
{
  "name": "broken-links",
  "describe": "Broken link report",
  "action": "broken-links",
  "agentAction": "broken-link-report",
  "capabilityKind": "observe",
  "every": "1d",
  "agent": "qa",
  "reviewer": "cto",
  "writesTo": ["broken-link-report"]
}
```

`agent-responsibility.md` stores the human-readable purpose and limits:

```md
# Broken link report

## Job

Check the docs for broken links and refresh the report.

## AgentAction

Run the `broken-link-report` agentAction. Its skill owns the detailed method and
runtime state handling.

## Output

Refresh `.kody/reports/broken-link-report.md`.

## Allowed Commands

- Run the `broken-link-report` agentAction.

## Restrictions

- Do not edit source files.
- Only update the generated report.
```

Do not put metadata frontmatter in `agent-responsibility.md`. Metadata belongs in
`profile.json`; prose belongs in `agent-responsibility.md`.

## Profile fields

| Field         | Meaning                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `name`        | AgentResponsibility slug. Must match the folder name.                                                           |
| `describe`    | Human-readable title shown in the dashboard.                                                     |
| `action`      | Public action token. `@kody <action>` runs this agentResponsibility. Usually the agentResponsibility slug.                     |
| `agentAction`  | Optional implementation agentAction slug. Use this for the one agentAction that performs the work. |
| `capabilityKind` | Capability kind: `observe`, `act`, or `verify`. |
| `every`       | Optional cadence: `manual`, `1h`, `1d`, `7d`, etc.                                               |
| `agent`      | Agent identity slug that performs the agentResponsibility. A agentResponsibility without an agent should not auto-run.          |
| `reviewer`    | Optional agent identity slug responsible for reviewing or handling the agentResponsibility output.               |
| `mentions`    | Optional GitHub logins to notify, without `@`.                                                   |
| `agentActions` | Multi-run agentAction list. Prefer singular `agentAction` for normal agentResponsibilities.                       |
| `tools`       | Optional agentResponsibility tool names exposed to the tick agent.                                             |
| `tickScript`  | Optional deterministic script path for a scripted agentResponsibility agent.                                   |
| `readsFrom`   | Context, report, or agentResponsibility slugs this agentResponsibility reads.                                                  |
| `writesTo`    | Report or context slugs this agentResponsibility writes.                                                        |
| `disabled`    | `true` pauses autonomous scheduling.                                                             |

## Output choice

The dashboard creation form has two output choices:

| Choice   | Meaning                                                                    |
| -------- | -------------------------------------------------------------------------- |
| `Run`    | The agentResponsibility runs work and does not promise a generated report.                |
| `Report` | The agentResponsibility refreshes one `.kody/reports/<slug>.md` file and sets `writesTo`. |

Use `Report` only when the report file is the durable artifact users should
read later. Use `Run` for checks, dispatches, comments, or any agentResponsibility whose proof
is activity/state rather than a report file.

## Body sections

### `## Job`

Say the agentResponsibility's actual job in plain language.

Good:

```md
Find stale open PRs and create a weekly report.
```

Bad:

```md
You are a senior engineering manager...
```

### `## AgentAction`

For agentAction-backed agentResponsibilities, name the agentAction and explain what outcome it
must produce. Keep the implementation details in the agentAction folder.

### `## Allowed Commands`

For agentAction-backed agentResponsibilities, list only the agentAction.

Keep shell commands, API calls, and long run logic out of the agentResponsibility. They belong
in agentAction skills or agentAction-owned scripts.

### `## Restrictions`

List hard limits.

Examples:

- Do not push branches.
- Do not comment on PRs.
- Do not edit source files.
- Only update `.kody/reports/<slug>.md`.

## Choosing between capability, agentAction, and agent

Use a **Capability** when the agency needs a reusable ability, especially one
that is recurring or public as an `@kody <action>`. Store it as a
agentResponsibility folder until the storage name changes.

Use an **agentAction** when you are defining implementation that a capability
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
- Which implementation agentAction runs the work, if needed.
- Which reports or context entries it reads or writes, if any.
- Which actions are forbidden.

If any of those are unclear, Kody should ask before creating the agentResponsibility.
