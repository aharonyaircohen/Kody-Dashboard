# Agents & AgentResponsibilities

The dashboard's autonomous-work model has three related concepts:

- **Agents** - `.kody/agents/<slug>.md`. A agent: who an actor is
  (character, values, doctrine). No work, no schedule, no commands owned by a
  recurring job. Edited on the `/agent` page.
- **AgentResponsibilities** - `.kody/agent-responsibilities/<slug>/`. A scheduled job: why the work exists,
  what outcome it maintains, how often it may run, and which agent agent runs
  it. Edited on the `/agent-responsibilities` page.
- **AgentActions** - `.kody/agent-actions/<slug>/`. The implementation a agentResponsibility can
  run: instructions, skills, scripts, tool wiring, and output contract.

A agentResponsibility folder always contains:

```text
.kody/agent-responsibilities/<slug>/
  profile.json
  agent-responsibility.md
```

`profile.json` is the machine-readable contract. `agent-responsibility.md` is the
human-readable purpose and limits. The engine's scheduler enumerates agentResponsibility
folders, reads `profile.json`, and ticks each due agentResponsibility.

## Why agent = identity, agentResponsibility = job

This split is load-bearing, not stylistic.

The agent is injected ahead of the agentResponsibility at run time. Anything concrete in the
agent - a task, a domain, a verb, an output format, a cadence - would silently
apply to every agentResponsibility that names that agent member. A `cto.md` that said "review
open PRs" would drag PR-review framing into a `cto`-run security sweep.

Keeping the agent to identity and values makes it composable. The same `cto`
can run a security audit, a changelog check, or a dependency sweep because each
agentResponsibility supplies its own job and the agent only supplies judgment and voice.

So:

|                         | Agents (agent)           | AgentResponsibility (job)              | AgentAction (implementation)                |
| ----------------------- | ------------------------ | -------------------------------------- | ------------------------------------------- |
| Path                    | `.kody/agents/<slug>.md` | `.kody/agent-responsibilities/<slug>/` | `.kody/agent-actions/<slug>/`               |
| Answers                 | Who is acting?           | Why/what/how often?                    | How is the work performed?                  |
| Owns the schedule?      | No                       | Yes, via `profile.json`                | No                                          |
| Owns the action name?   | No                       | Yes, `profile.json.action`             | No                                          |
| Owns reusable method?   | No                       | No                                     | Yes, via skills/scripts/prompts             |
| Names the agent member? | No                       | Yes, `profile.json.runner`             | No                                          |
| Independently ticked?   | No                       | Yes                                    | No, unless a agentResponsibility invokes it |

## AgentResponsibility profile

The profile is JSON, not markdown frontmatter:

```json
{
  "name": "security-audit",
  "describe": "Security Audit",
  "action": "security-audit",
  "agentAction": "security-audit",
  "every": "1d",
  "runner": "kody",
  "reviewer": "cto",
  "mentions": ["aguyaharonyair"],
  "writesTo": ["security-audit"]
}
```

Important fields:

- `name` - agentResponsibility slug; should match the folder name.
- `describe` - human-readable dashboard title.
- `action` - public `@kody <action>` command owned by this agentResponsibility.
- `agentAction` - implementation agentAction for normal one-agentAction agentResponsibilities.
- `agentActions` - optional multi-agentAction list.
- `every` - cadence between auto-runs: `15m`, `30m`, `1h`, `2h`, `6h`, `12h`,
  `1d`, `3d`, `7d`, or `manual`.
- `disabled` - `true` makes the scheduler skip autonomous execution.
- `runner` - slug of the agent under `.kody/agents/<slug>.md` that performs
  the agentResponsibility.
- `reviewer` - optional agent slug responsible for treating the output after
  the agentResponsibility produces it.
- `mentions` - GitHub logins the agentResponsibility output should mention, without `@`.
- `tools` - optional agentResponsibility tool names exposed to the runner.
- `tickScript` - optional deterministic script path for a scripted agentResponsibility.
- `readsFrom` / `writesTo` - context, report, or agentResponsibility slugs that form the
  agentResponsibility's data contract.

The dashboard create form asks for an output type:

- `Run` - no generated report is promised.
- `Report` - one `reports/<slug>.md` file in the configured Kody state repo is the durable output, and the
  report slug is stored in `writesTo`.

A agentResponsibility with no `runner` should not auto-run. A agentResponsibility pointing at a missing agent
file is a hard error at tick time.

`runner` and `reviewer` are different agent roles: `runner` performs the agentResponsibility;
`reviewer` owns the result after it exists.

## AgentResponsibility body

`agent-responsibility.md` is markdown prose only. Do not add frontmatter.

Use the body for:

- `# Title`
- `## Job` - the purpose and outcome.
- `## AgentAction` - which agentAction to run, if any.
- `## Output` - the expected report/context/result.
- `## Allowed Commands` - usually just the agentAction, not shell recipes.
- `## Restrictions` - hard limits.

Keep reusable runbooks in agentAction skills and deterministic shell/API work in
agentAction-owned scripts. The agentResponsibility should remain readable to the user who is
orchestrating the company.

## How a tick flows

```text
engine cron
  -> agentResponsibility scheduler
     -> enumerate .kody/agent-responsibilities/<slug>/ folders
     -> read profile.json
     -> skip disabled/no-runner/not-due agentResponsibilities
     -> run the due agentResponsibility action
        -> load agent-responsibility.md
        -> inject .kody/agents/<runner>.md agent
        -> run linked agentAction when configured
        -> write activity/state for the dashboard
```

Key points:

- The scheduler runs no agent. It only fans out due agentResponsibilities.
- The skip gates are: `disabled: true`, missing `runner`, and `every` cadence not
  due yet.
- `every: manual` never auto-fires; the dashboard "Run now" button still works.
- Manual "Run now" bypasses the scheduler gate but the agentResponsibility still needs a valid
  agent member.
- Cadence state is engine-owned and stored outside the agentResponsibility folder's authoring
  contract.

## State files

Runtime state is not part of the agentResponsibility authoring surface. The engine writes it
under the configured Kody state repo, and the dashboard reads it to render run status:

- `lastTickAt` - last visible run time.
- `nextEligibleAt` - next known eligible run time, when the engine provides it.
- `lastOutcome` - coarse result of the most recent tick.
- `lastDurationMs` - wall-clock duration of the most recent tick.

Users creating agentResponsibilities should not author state keys. State mechanics stay behind
the engine and dashboard runtime contract.

## Editing and manual runs

- `/agent` lists and edits personas. Agents create/update payloads take `slug`,
  `title`, and `body`.
- `/agent-responsibilities` lists and edits agentResponsibility folders. The dashboard writes
  `profile.json` and `agent-responsibility.md` together.
- "Run now" dispatches the agentResponsibility action for one slug immediately.
- Slugs must match `^[a-z0-9][a-z0-9_-]{0,63}$`.

## A note on cron cadence

Three cadence concepts are in play:

- The workflow wake controls how often the scheduler gets a chance to look.
- `profile.json.every` controls how often a specific agentResponsibility may run.
- Dashboard relative-time labels mirror the scheduler wake only for display.

So the wake is only the outer loop. The agentResponsibility's own `every` value is the
important per-agentResponsibility throttle.

## File reference

| File                                                                                                                                               | Purpose                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [`docs/agent-responsibilities.md`](../agent-responsibilities.md)                                                                                   | AgentResponsibility creation guide and folder contract |
| [`src/dashboard/lib/agent-files.ts`](../../src/dashboard/lib/agent-files.ts)                                                                       | Agents markdown store                                  |
| [`src/dashboard/lib/agent-responsibilities-files.ts`](../../src/dashboard/lib/agent-responsibilities-files.ts)                                     | Folder-backed agentResponsibility store                |
| [`src/dashboard/lib/ticked/schedule.ts`](../../src/dashboard/lib/ticked/schedule.ts)                                                               | Dashboard next-tick display math                       |
| [`app/api/kody/agent/route.ts`](../../app/api/kody/agent/route.ts)                                                                                 | Agents API                                             |
| [`app/api/kody/agent-responsibilities/route.ts`](../../app/api/kody/agent-responsibilities/route.ts)                                               | AgentResponsibilities API                              |
| [`.kody/agents/cto.md`](../../.kody/agents/cto.md)                                                                                                 | Example identity-only agent                            |
| [`.kody/agent-responsibilities/security-audit/agent-responsibility.md`](../../.kody/agent-responsibilities/security-audit/agent-responsibility.md) | Example agentResponsibility body                       |
| [`.kody/agent-responsibilities/security-audit/profile.json`](../../.kody/agent-responsibilities/security-audit/profile.json)                       | Example agentResponsibility profile                    |
| `kody2/src/scripts/dispatchAgentResponsibilityFileTicks.ts` (engine)                                                                               | Scheduler fan-out                                      |
| `kody2/src/scripts/loadJobFromFile.ts` (engine)                                                                                                    | AgentResponsibility loader                             |

## FAQ

**Can a agent agent include the work it should do?**

No. The agent is injected ahead of every agentResponsibility that names it, so concrete
behavior would leak across agentResponsibilities. Put job intent in the agentResponsibility and reusable
method in the agentAction.

**What happens if a agentResponsibility's `runner` points at a deleted agent?**

It is a hard error at tick time. A agentResponsibility never runs without the executor
identity it declared.

**Can a agentResponsibility have no schedule?**

Yes. With no `every` value it is eligible on every scheduler wake. Use
`manual` for "Run now only", or a cadence token to throttle.

**Does disabling a agentResponsibility stop "Run now"?**

No. `disabled: true` only blocks autonomous execution. Manual "Run now" still
fires.

**Where does "next run" come from?**

From engine state, not from the agentResponsibility body. The dashboard displays it when the
engine has written it.
