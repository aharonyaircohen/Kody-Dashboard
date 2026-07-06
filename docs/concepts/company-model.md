# AI Agency model

This is the source of truth for where AI Agency concepts belong.

The short rule:

```text
Intent = why
Goal = what
Loop = when
Agent = who
Capability = how
Workflow = composed how
Context = background facts
Instructions = chat behavior
State = what happened
```

If a new agency file mixes two rows, stop and split it before adding more
behavior.

## Intent-led company growth

The AI agency should grow from intent, not from available automation.

Core rule:

```text
Every durable agency object should trace back to an intent.
Not every intent should create durable agency structure.
```

Use intents as human direction. The manager interprets them and creates the
smallest useful structure only when the need is stable:

| Step      | Meaning                                                   |
| --------- | --------------------------------------------------------- |
| Intent    | Human says what Kody should care about                    |
| Manager   | Decides whether the current agency structure is enough    |
| Goal      | Created only for a concrete outcome that should become true |
| Loop      | Created only for recurring attention                      |
| Capability | Reused when possible; added only when no existing ability fits |
| Link back | New goals and loops must be attached to the intent they serve |

The manager should prefer a note over new structure when the intent is vague,
temporary, already covered, or too small to justify durable machinery.

Intent has two text levels:

```text
for = short one-line direction shown in lists
description = optional deeper context, constraints, examples, and what good looks like
```

The description helps the manager interpret the intent. It must not become a
second intent, a behavior selector, or an execution route.

## Canonical terms

Use these terms when explaining the agency model to humans or coding agents:

| Concept    | Simple meaning                      | Owns                                                                                          | Must not own                                                      |
| ---------- | ----------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Intent     | Why this exists                     | Agency direction, priority, posture, scope, success signals                                   | Low-level execution steps                                         |
| Goal       | What should become true             | The result to reach, evidence, current progress, blockers                                     | Detailed worker identity or low-level method                      |
| Loop       | When to check                       | Cadence, heartbeat, and which goal or capability to wake                                      | The detailed implementation of each capability                    |
| Agent      | Who is acting                       | Identity, judgment style, values, role voice                                                  | A job, schedule, tool recipe, or output contract                  |
| Capability | How the agency can produce a result | A reusable ability, its kind, inputs, outputs, tools/data/instructions, and execution binding | Agency direction, long-term progress, or agent identity           |
| Workflow   | How capabilities are chained        | Ordered capability steps for one run, shared step results, final output                       | Agency direction, long-term progress, schedule, or agent identity |

Capability kinds:

```text
Observe = inspect state and return facts
Act = change something or trigger work
Verify = confirm pass/fail evidence
```

## Storage names

The public model has no separate "implementation" concept. Capability is the
operator-facing concept. Some files and config keys still say `implementation` for
compatibility; read that as "capability implementation", not as a new model.

```text
Capability = contract + implementation
```

## Ownership rules

This table is kept only to make the storage split explicit:

| Storage name   | Owns                                                                                                            | Must not own                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Capability     | Capability contract: public action name, kind, owner, cadence, safety, inputs, outputs, and implementation link | Long identity prompt or low-level implementation                   |
| Workflow       | Ordered capability steps for one run                                                                            | Business progress, schedule, identity, or implementation internals |
| Implementation | Prompt glue, skills, scripts, tools, landing, output contract                                                   | Agency direction, cadence, public ownership, or long-term progress |
| Context        | Facts Kody should know while reasoning                                                                          | Source-of-truth policy or scheduled work                           |
| Instructions   | Chat response behavior such as tone, length, and format                                                         | Agency facts or agency structure                                   |
| State          | Runtime facts: last run, pending work, outcome, logs                                                            | Authoring rules or portable agency doctrine                        |

## Where rules live

Use three layers:

| Layer   | Purpose                                                 |
| ------- | ------------------------------------------------------- |
| Docs    | Source of truth for the model                           |
| Context | Short reminders that Kody should see during normal work |
| Doctor  | Checks that the files follow the model                  |

Do not hide the model only in Context. Context is easy for Kody to read, but docs
are where humans and agents should find the durable contract.

Good Context reminder:

```text
Follow docs/concepts/company-model.md.
Use Intent/Goal/Loop/Agent/Capability/Workflow as the agency model.
Treat `implementation` as an old storage/config word for capability implementation.
```

## Dependency graph

The AI Agency Map should be a real dependency graph, not just a visual chart.

Nodes:

```text
agent
capability
workflow
implementation
goal
loop
intent
context
command
tool
report
```

Edges:

| Edge                         | Meaning                                                     |
| ---------------------------- | ----------------------------------------------------------- |
| intent -> goal/loop          | This why is carried by these operating pieces               |
| goal -> capability           | This result depends on this reusable ability                |
| loop -> goal                 | This loop checks this goal                                  |
| loop -> capability           | This loop may dispatch this capability                      |
| workflow -> capability       | This run chains these capability steps                      |
| capability -> agent          | This capability runs as this identity                       |
| capability -> capability     | This capability is currently stored as this contract folder |
| capability -> implementation | This capability uses this implementation                    |
| implementation -> tool       | This implementation needs this tool                         |
| capability -> report/context | This capability reads or writes this artifact               |

The graph should answer:

```text
What uses this?
What breaks if this is removed?
What is active?
What is missing?
What is local vs Store-backed?
```

The graph is generated from agency files and config. It is not the source of
truth.

## AI Agency Doctor

AI Agency Doctor is the checker for the graph.

It should run in two ways:

```text
Manual: user clicks/checks now
Scheduled: a loop checks regularly
```

At first, Doctor should report instead of fixing automatically.

Checks:

```text
missing agent
missing implementation
missing goal capability
inactive item used by an active goal
duplicate capabilities
too much work in one loop
agent contains job instructions
capability contract contains implementation runbook
```

## Run lanes

A run lane is a separate work lane with its own safety rules.

Do not put all agency work in one pile.

Examples:

| Lane     | Kind of work                    | Typical rule                          |
| -------- | ------------------------------- | ------------------------------------- |
| CI       | Keep checks green               | Can run often                         |
| PR       | Keep pull requests moving       | Avoid duplicate comments/work         |
| Release  | Prepare and ship releases       | Run carefully, require clear evidence |
| QA       | Browser or product verification | Needs auth/session readiness          |
| Docs     | Keep docs accurate              | Lower urgency                         |
| Security | Sensitive review                | Slower and stricter                   |

Lanes give scale without making one giant queue. More lanes can run safely when
their work does not touch the same thing.

## Naming rule

Prefer clearer ownership over new concepts.

Before adding a new model, ask:

```text
Is this actually an agent, capability, workflow, goal, loop, intent, context,
instruction, or state?
```

If yes, use the existing concept. If no, write the new ownership rule here first.
