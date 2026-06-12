# Staff & Duties

The dashboard's autonomous-work model has three related concepts:

- **Staff** - `.kody/staff/<slug>.md`. A persona: who an actor is
  (character, values, doctrine). No work, no schedule, no commands owned by a
  recurring job. Edited on the `/staff` page.
- **Duties** - `.kody/duties/<slug>/`. A scheduled job: why the work exists,
  what outcome it maintains, how often it may run, and which staff persona runs
  it. Edited on the `/duties` page.
- **Executables** - `.kody/executables/<slug>/`. The implementation a duty can
  run: instructions, skills, scripts, tool wiring, and output contract.

A duty folder always contains:

```text
.kody/duties/<slug>/
  profile.json
  duty.md
```

`profile.json` is the machine-readable contract. `duty.md` is the
human-readable purpose and limits. The engine's scheduler enumerates duty
folders, reads `profile.json`, and ticks each due duty.

## Why persona = identity, duty = job

This split is load-bearing, not stylistic.

The persona is injected ahead of the duty at run time. Anything concrete in the
persona - a task, a domain, a verb, an output format, a cadence - would silently
apply to every duty that names that staff member. A `cto.md` that said "review
open PRs" would drag PR-review framing into a `cto`-run security sweep.

Keeping the persona to identity and values makes it composable. The same `cto`
can run a security audit, a changelog check, or a dependency sweep because each
duty supplies its own job and the persona only supplies judgment and voice.

So:

|                         | Staff (persona)         | Duty (job)                   | Executable (implementation)       |
| ----------------------- | ----------------------- | ---------------------------- | --------------------------------- |
| Path                    | `.kody/staff/<slug>.md` | `.kody/duties/<slug>/`       | `.kody/executables/<slug>/`       |
| Answers                 | Who is acting?          | Why/what/how often?          | How is the work performed?        |
| Owns the schedule?      | No                      | Yes, via `profile.json`      | No                                |
| Owns the action name?   | No                      | Yes, `profile.json.action`   | No                                |
| Owns reusable method?   | No                      | No                           | Yes, via skills/scripts/prompts   |
| Names the staff member? | No                      | Yes, `profile.json.staff`    | No                                |
| Independently ticked?   | No                      | Yes                          | No, unless a duty invokes it      |

## Duty profile

The profile is JSON, not markdown frontmatter:

```json
{
  "name": "security-audit",
  "describe": "Security Audit",
  "action": "security-audit",
  "executable": "security-audit",
  "every": "1d",
  "staff": "kody",
  "stage": "sweep",
  "mentions": ["aguyaharonyair"],
  "writesTo": ["security-audit"]
}
```

Important fields:

- `name` - duty slug; should match the folder name.
- `describe` - human-readable dashboard title.
- `action` - public `@kody <action>` command owned by this duty.
- `executable` - implementation executable for normal one-executable duties.
- `executables` - optional multi-executable list.
- `every` - cadence between auto-runs: `15m`, `30m`, `1h`, `2h`, `6h`, `12h`,
  `1d`, `3d`, `7d`, or `manual`.
- `disabled` - `true` makes the scheduler skip autonomous execution.
- `staff` - slug of the persona under `.kody/staff/<slug>.md`.
- `stage` - dashboard progress template, such as `simple-check`,
  `report-refresh`, `sweep`, `approval-gate`, or `review-loop`.
- `mentions` - GitHub logins the duty output should mention, without `@`.
- `tools` - optional duty tool names exposed to the runner.
- `tickScript` - optional deterministic script path for a scripted duty.
- `readsFrom` / `writesTo` - context, report, or duty slugs that form the
  duty's data contract.

A duty with no `staff` should not auto-run. A duty pointing at a missing staff
file is a hard error at tick time.

## Duty body

`duty.md` is markdown prose only. Do not add frontmatter.

Use the body for:

- `# Title`
- `## Job` - the purpose and outcome.
- `## Executable` - which executable to run, if any.
- `## Output` - the expected report/context/result.
- `## Allowed Commands` - usually just the executable, not shell recipes.
- `## Restrictions` - hard limits.

Keep reusable runbooks in executable skills and deterministic shell/API work in
executable-owned scripts. The duty should remain readable to the user who is
orchestrating the company.

## How a tick flows

```text
engine cron
  -> duty scheduler
     -> enumerate .kody/duties/<slug>/ folders
     -> read profile.json
     -> skip disabled/no-staff/not-due duties
     -> run the due duty action
        -> load duty.md
        -> inject .kody/staff/<staff>.md persona
        -> run linked executable when configured
        -> write activity/state for the dashboard
```

Key points:

- The scheduler runs no agent. It only fans out due duties.
- The skip gates are: `disabled: true`, missing `staff`, and `every` cadence not
  due yet.
- `every: manual` never auto-fires; the dashboard "Run now" button still works.
- Manual "Run now" bypasses the scheduler gate but the duty still needs a valid
  staff member.
- Cadence state is engine-owned and stored outside the duty folder's authoring
  contract.

## State files

Runtime state is not part of the duty authoring surface. The engine writes it
under the state branch, and the dashboard reads it to render run status:

- `lastTickAt` - last visible run time.
- `nextEligibleAt` - next known eligible run time, when the engine provides it.
- `lastOutcome` - coarse result of the most recent tick.
- `lastDurationMs` - wall-clock duration of the most recent tick.

Users creating duties should pick a `stage` template instead of hand-authoring
state keys. The template hides state mechanics behind a simple product concept.

## Editing and manual runs

- `/staff` lists and edits personas. Staff create/update payloads take `slug`,
  `title`, and `body`.
- `/duties` lists and edits duty folders. The dashboard writes
  `profile.json` and `duty.md` together.
- "Run now" dispatches the duty action for one slug immediately.
- Slugs must match `^[a-z0-9][a-z0-9_-]{0,63}$`.

## A note on cron cadence

Three cadence concepts are in play:

- The workflow wake controls how often the scheduler gets a chance to look.
- `profile.json.every` controls how often a specific duty may run.
- Dashboard relative-time labels mirror the scheduler wake only for display.

So the wake is only the outer loop. The duty's own `every` value is the
important per-duty throttle.

## File reference

| File                                                                                       | Purpose                                                          |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [`docs/duties.md`](../duties.md)                                                           | Duty creation guide and folder contract                          |
| [`src/dashboard/lib/staff-files.ts`](../../src/dashboard/lib/staff-files.ts)               | Staff markdown store                                             |
| [`src/dashboard/lib/duties-files.ts`](../../src/dashboard/lib/duties-files.ts)             | Folder-backed duty store                                         |
| [`src/dashboard/lib/ticked/schedule.ts`](../../src/dashboard/lib/ticked/schedule.ts)       | Dashboard next-tick display math                                 |
| [`app/api/kody/staff/route.ts`](../../app/api/kody/staff/route.ts)                         | Staff API                                                        |
| [`app/api/kody/duties/route.ts`](../../app/api/kody/duties/route.ts)                       | Duties API                                                       |
| [`.kody/staff/cto.md`](../../.kody/staff/cto.md)                                           | Example identity-only persona                                    |
| [`.kody/duties/security-audit/duty.md`](../../.kody/duties/security-audit/duty.md)         | Example duty body                                                |
| [`.kody/duties/security-audit/profile.json`](../../.kody/duties/security-audit/profile.json) | Example duty profile                                             |
| `kody2/src/scripts/dispatchDutyFileTicks.ts` (engine)                                      | Scheduler fan-out                                                |
| `kody2/src/scripts/loadJobFromFile.ts` (engine)                                            | Duty loader                                                      |

## FAQ

**Can a staff persona include the work it should do?**

No. The persona is injected ahead of every duty that names it, so concrete
behavior would leak across duties. Put job intent in the duty and reusable
method in the executable.

**What happens if a duty's `staff` points at a deleted persona?**

It is a hard error at tick time. A duty never runs without the executor
identity it declared.

**Can a duty have no schedule?**

Yes. With no `every` value it is eligible on every scheduler wake. Use
`manual` for "Run now only", or a cadence token to throttle.

**Does disabling a duty stop "Run now"?**

No. `disabled: true` only blocks autonomous execution. Manual "Run now" still
fires.

**Where does "next run" come from?**

From engine state, not from the duty body. The dashboard displays it when the
engine has written it.
