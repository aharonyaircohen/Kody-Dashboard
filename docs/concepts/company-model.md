# Company model

This is the source of truth for where company concepts belong.

The short rule:

```text
Intent = why
Goal = what
Loop = when
Agent = who
Capability = how
Context = background facts
Instructions = chat behavior
State = what happened
```

If a new company file mixes two rows, stop and split it before adding more
behavior.

## Canonical terms

Use these terms when explaining the agency model to humans or coding agents:

| Concept | Simple meaning | Owns | Must not own |
| --- | --- | --- | --- |
| Intent | Why this exists | Company direction, priority, posture, scope, success signals | Low-level execution steps |
| Goal | What should become true | The result to reach, evidence, current progress, blockers | Detailed worker identity or low-level method |
| Loop | When to check | Cadence, heartbeat, and which goal or capability to wake | The detailed implementation of each capability |
| Agent | Who is acting | Identity, judgment style, values, role voice | A job, schedule, tool recipe, or output contract |
| Capability | How the agency can produce a result | A reusable ability, its kind, inputs, outputs, tools/data/instructions, and execution binding | Company direction, long-term progress, or agent identity |

Capability kinds:

```text
Observe = inspect state and return facts
Act = change something or trigger work
Verify = confirm pass/fail evidence
```

## Current storage names

Some files still use older names. Treat them as storage/compatibility names, not
the public model:

| Current name | Canonical meaning |
| --- | --- |
| Capability | Capability contract |
| Executable | Capability implementation |

So the practical rule is:

```text
Capability = Capability contract + Executable implementation
```

## Ownership rules

This table is kept only to make the legacy storage split explicit:

| Storage name | Owns | Must not own |
| --- | --- | --- |
| Capability | Capability contract: public action name, kind, owner, cadence, safety, inputs, outputs, and implementation link | Long identity prompt or low-level implementation |
| Executable | Capability implementation: prompt glue, skills, scripts, tools, landing, output contract | Company direction, cadence, public ownership, or long-term progress |
| Context | Facts Kody should know while reasoning | Source-of-truth policy or scheduled work |
| Instructions | Chat response behavior such as tone, length, and format | Company facts or agency structure |
| State | Runtime facts: last run, pending work, outcome, logs | Authoring rules or portable company doctrine |

## Where rules live

Use three layers:

| Layer | Purpose |
| --- | --- |
| Docs | Source of truth for the model |
| Context | Short reminders that Kody should see during normal work |
| Doctor | Checks that the files follow the model |

Do not hide the model only in Context. Context is easy for Kody to read, but docs
are where humans and agents should find the durable contract.

Good Context reminder:

```text
Follow docs/concepts/company-model.md.
Use Intent/Goal/Loop/Agent/Capability as the agency model.
Treat Capability and Executable as current storage names for Capability.
```

## Dependency graph

The Company Map should be a real dependency graph, not just a visual chart.

Nodes:

```text
agent
capability
capability
executable
goal
loop
intent
context
command
tool
report
```

Edges:

| Edge | Meaning |
| --- | --- |
| intent -> goal/loop | This why is carried by these operating pieces |
| goal -> capability | This result depends on this reusable ability |
| loop -> goal | This loop checks this goal |
| loop -> capability | This loop may dispatch this capability |
| capability -> agent | This capability runs as this identity |
| capability -> capability | This capability is currently stored as this contract folder |
| capability -> executable | This capability uses this implementation |
| executable -> tool | This implementation needs this tool |
| capability -> report/context | This capability reads or writes this artifact |

The graph should answer:

```text
What uses this?
What breaks if this is removed?
What is active?
What is missing?
What is local vs Store-backed?
```

The graph is generated from company files and config. It is not the source of
truth.

## Company Doctor

Company Doctor is the checker for the graph.

It should run in two ways:

```text
Manual: user clicks/checks now
Scheduled: a loop checks regularly
```

At first, Doctor should report instead of fixing automatically.

Checks:

```text
missing agent
missing executable
missing goal capability
inactive item used by an active goal
duplicate capabilities
too much work in one loop
agent contains job instructions
capability contract contains implementation runbook
```

## Run lanes

A run lane is a separate work lane with its own safety rules.

Do not put all company work in one pile.

Examples:

| Lane | Kind of work | Typical rule |
| --- | --- | --- |
| CI | Keep checks green | Can run often |
| PR | Keep pull requests moving | Avoid duplicate comments/work |
| Release | Prepare and ship releases | Run carefully, require clear evidence |
| QA | Browser or product verification | Needs auth/session readiness |
| Docs | Keep docs accurate | Lower urgency |
| Security | Sensitive review | Slower and stricter |

Lanes give scale without making one giant queue. More lanes can run safely when
their work does not touch the same thing.

## Naming rule

Prefer clearer ownership over new concepts.

Before adding a new model, ask:

```text
Is this actually an agent, capability, goal, loop, intent, context,
instruction, or state?
```

If yes, use the existing concept. If no, write the new ownership rule here first.
