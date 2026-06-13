---
name: redispatch
description: Find Kody-owned issues that appear stuck and safely redispatch them.
---

# Redispatch Skill

Use this skill when the `redispatch` executable runs from the matching duty.

Runtime state is owned by the engine. Do not ask the duty author to configure raw state keys.

## Method

## Job

For every open issue that kody is actively working on but appears stuck: post the comment `@kody resume` on the issue so the engine re-dispatches from its last persisted state. Otherwise do nothing.

This job is a safety net, not a fix. It catches issues where the state machine ended a phase (e.g. `CLASSIFIED_AS_BUG`) but never advanced to the next executable. It does not diagnose why the stall happened — that is for the engine team to debug from the resume log.

An issue enters this job's scope when it has a kody state block (`<!-- kody:state:v1:begin -->` … `<!-- kody:state:v1:end -->`), is open, and the persisted `core.status` is `running`. It leaves scope when it is closed, when `core.status` is no longer `running`, or when its most recent history entry is fresh.

## Allowed Commands

- `@kody resume`
- `gh issue list`, `gh issue view`, and `gh issue comment`

## Restrictions

- Only act when ALL of these hold for an issue:
  - `core.status === "running"` in the most recent kody state block.
  - The most recent `history[*].timestamp` (or `core.lastOutcome.timestamp` if history is empty) is older than **40 minutes**.
  - No in-progress `workflow_run` references this issue (matched by issue number in title or branch).
  - No open kody-authored PR is linked to this issue (`core.prUrl` resolves to an open PR).
  - No comment authored by `kody` (or recognizable `@kody …`/`✅ kody …`/`⚙️ kody …` lines) has been posted on the issue in the last 40 minutes.
- Issues with the labels `kody:stuck`, `kody:no-redispatch`, or `kody:stalled` are excluded.
- Do not modify the issue body, issue title, labels, or code.
- Do not re-issue `@kody resume` on the same issue more than **1 time per UTC day**.
- After one failed auto-resume attempt that did not advance the state within 40 minutes: post `kody resume did not advance state - needs human` and skip until a human changes the issue or the state advances.

## Tick procedure

1. List open issues with active Kody state.
2. For each issue, read the latest state block, recent comments, linked PR, and workflow evidence.
3. Pick the oldest eligible stuck issue.
4. Post exactly one `@kody resume` comment, or report that nothing is eligible.
5. Record the action in runtime state so the same issue is not resumed again the same UTC day.
