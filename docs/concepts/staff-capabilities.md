# Agents And Capabilities

The canonical agency model lives in [`company-model.md`](./company-model.md).
This page explains the Dashboard authoring surface that implements it.

Current storage has three related pieces:

- **Agents** - `.kody/agents/<slug>.md`. A agent: who an actor is
  (character, values, doctrine). This is the canonical **who**.
- **Capabilities** - `.kody/capabilities/<slug>/`. The canonical **how**:
  public action name, owner, cadence, safety, inputs, outputs,
  tools/data/instructions, and execution binding.
- **Legacy implementation roots** -
  `.kody/capabilities/<slug>/` and `.kody/implementations/<slug>/`.
  These are compatibility roots while older repos migrate.

A capability folder always contains:

```text
.kody/capabilities/<slug>/
  profile.json
  capability.md
```

`profile.json` is the machine-readable contract and execution wiring.
`capability.md` is the human-readable purpose and limits. The engine reads
capabilities first, then falls back to legacy roots.

## Why agent stays identity-only

This split is load-bearing, not stylistic.

The agent is injected ahead of the capability at run time. Anything concrete in
the agent - a task, a domain, a verb, an output format, a cadence - would silently
apply to every capability that names that agent member. A `cto.md` that said "review
open PRs" would drag PR-review framing into a `cto`-run security sweep.

Keeping the agent to identity and values makes it composable. The same `cto`
can run a security audit, a changelog check, or a dependency sweep because each
capability supplies its own job and the agent only supplies judgment and voice.

So in storage terms:

|                         | Agents (who)             | Capability (how)                                | Legacy roots                                                  |
| ----------------------- | ------------------------ | ----------------------------------------------- | ------------------------------------------------------------- |
| Path                    | `.kody/agents/<slug>.md` | `.kody/capabilities/<slug>/`                    | `.kody/capabilities/<slug>/`, `.kody/implementations/<slug>/` |
| Answers                 | Who is acting?           | What capability is available?                   | How is older stored implementation found?                     |
| Owns the schedule?      | No                       | Only the capability cadence, via `profile.json` | Compatibility only                                            |
| Owns the action name?   | No                       | Yes, `profile.json.action`                      | No                                                            |
| Owns reusable method?   | No                       | Yes, through skills/scripts/prompts when needed | Compatibility only                                            |
| Names the agent member? | No                       | Yes, `profile.json.agent` or legacy `runner`    | No                                                            |
| Independently ticked?   | No                       | Yes                                             | Only for legacy compatibility                                 |

## Capability profile

The profile is JSON, not markdown frontmatter:

```json
{
  "name": "security-audit",
  "describe": "Security Audit",
  "action": "security-audit",
  "implementation": "security-audit",
  "every": "1d",
  "agent": "kody",
  "reviewer": "cto",
  "mentions": ["aguyaharonyair"],
  "writesTo": ["security-audit"]
}
```

Important fields:

- `name` - capability slug; should match the folder name.
- `describe` - human-readable dashboard title.
- `action` - public `@kody <action>` command owned by this capability.
- `implementation` - legacy field name for the implementation reference.
- `implementations` - optional legacy field name for a multi-step implementation list.
- `every` - cadence between auto-runs: `15m`, `30m`, `1h`, `2h`, `6h`, `12h`,
  `1d`, `3d`, `7d`, or `manual`.
- `disabled` - `true` makes the scheduler skip autonomous execution.
- `agent` - slug of the agent under `.kody/agents/<slug>.md` that performs the
  capability. Older profiles may still use `runner`.
- `reviewer` - optional agent slug responsible for treating the output after
  the capability produces it.
- `mentions` - GitHub logins the capability output should mention, without `@`.
- `tools` - optional locked tool names exposed to the runner.
- `tickScript` - optional deterministic script path for a scripted capability.
- `readsFrom` / `writesTo` - context, report, or capability slugs that form the
  capability's data contract.

The dashboard create form asks for an output type:

- `Run` - no generated report is promised.
- `Report` - timestamped files under `reports/<slug>/runs/` in the configured
  Kody state repo are the durable output, and the report slug is stored in
  `writesTo`.

A capability with no agent should not auto-run. A capability pointing at a
missing agent file is a hard error at tick time.

`agent` and `reviewer` are different roles: `agent` performs the capability;
`reviewer` owns the result after it exists.

## Capability body

`capability.md` is markdown prose only. Do not add frontmatter. Legacy
`capability.md` files follow the same rule.

Use the body for:

- `# Title`
- `## Job` - the capability purpose and outcome.
- `## Implementation` - which implementation to run, if any.
- `## Output` - the expected report/context/result.
- `## Allowed Commands` - usually just the capability action, not shell recipes.
- `## Restrictions` - hard limits.

Keep reusable runbooks in skills and deterministic shell/API work in scripts.
The capability should remain readable as the operator-facing contract.

## How a tick flows

```text
engine cron
  -> capability scheduler
     -> enumerate .kody/capabilities/<slug>/ folders
     -> read profile.json
     -> skip disabled/no-agent/not-due capabilities
     -> run the due capability action
        -> load capability.md
        -> inject .kody/agents/<agent>.md agent
        -> run configured implementation
        -> write activity/state for the dashboard
```

Key points:

- The scheduler runs no agent. It only fans out due capabilities.
- The skip gates are: `disabled: true`, missing `agent`, and `every` cadence not
  due yet.
- `every: manual` never auto-fires; the dashboard "Run now" button still works.
- Manual "Run now" bypasses the scheduler gate but the capability still needs a valid
  agent member.
- Cadence state is engine-owned and stored outside the capability folder's authoring
  contract.

## State files

Runtime state is not part of the capability authoring surface. The engine writes it
under the configured Kody state repo, and the dashboard reads it to render run status:

- `lastTickAt` - last visible run time.
- `nextEligibleAt` - next known eligible run time, when the engine provides it.
- `lastOutcome` - coarse result of the most recent tick.
- `lastDurationMs` - wall-clock duration of the most recent tick.

Users creating capabilities should not author state keys. State mechanics stay behind
the engine and dashboard runtime contract.

## Editing and manual runs

- `/agent` lists and edits personas. Agents create/update payloads take `slug`,
  `title`, and `body`.
- `/capabilities` lists and edits capability folders. The dashboard writes
  `profile.json` and `capability.md` together.
- "Run now" dispatches the capability action for one slug immediately.
- Slugs must match `^[a-z0-9][a-z0-9_-]{0,63}$`.

## A note on cron cadence

Three cadence concepts are in play:

- The workflow wake controls how often the scheduler gets a chance to look.
- `profile.json.every` controls how often a specific capability may run.
- Dashboard relative-time labels mirror the scheduler wake only for display.

So the wake is only the outer loop. The capability's own `every` value is the
important per-capability throttle.

## File reference

| File                                                                                       | Purpose                                             |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| [`docs/capabilities.md`](../capabilities.md)                                               | Capability contract guide and legacy fallback notes |
| [`src/dashboard/lib/agent-files.ts`](../../src/dashboard/lib/agent-files.ts)               | Agents markdown store                               |
| [`src/dashboard/lib/capabilities`](../../src/dashboard/lib/capabilities)                   | Capability store exports                            |
| [`src/dashboard/lib/capabilities-files.ts`](../../src/dashboard/lib/capabilities-files.ts) | Legacy fallback store                               |
| [`src/dashboard/lib/ticked/schedule.ts`](../../src/dashboard/lib/ticked/schedule.ts)       | Dashboard next-tick display math                    |
| [`app/api/kody/agent/route.ts`](../../app/api/kody/agent/route.ts)                         | Agents API                                          |
| [`app/api/kody/capabilities/route.ts`](../../app/api/kody/capabilities/route.ts)           | Capabilities API                                    |
| [`.kody/agents/cto.md`](../../.kody/agents/cto.md)                                         | Example identity-only agent                         |
| `kody2/src/scripts/dispatchCapabilityFileTicks.ts` (engine)                                | Scheduler fan-out                                   |
| `kody2/src/scripts/loadJobFromFile.ts` (engine)                                            | Capability/legacy capability loader                 |

## FAQ

**Can a agent include the work it should do?**

No. The agent is injected ahead of every capability that names it, so concrete
behavior would leak across capabilities. Put the capability contract in the
capability folder and reusable method in its skills/scripts.

**What happens if a capability's `agent` points at a deleted agent?**

It is a hard error at tick time. A capability never runs without the executor
identity it declared.

**Can a capability have no schedule?**

Yes. With no `every` value it is eligible on every scheduler wake. Use
`manual` for "Run now only", or a cadence token to throttle.

**Does disabling a capability stop "Run now"?**

No. `disabled: true` only blocks autonomous execution. Manual "Run now" still
fires.

**Where does "next run" come from?**

From engine state, not from the capability body. The dashboard displays it when the
engine has written it.
