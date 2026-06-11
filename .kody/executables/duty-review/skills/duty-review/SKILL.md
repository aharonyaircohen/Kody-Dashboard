---
name: duty-review
description: Review one duty at a time for design soundness, reachable wiring, cadence, and observed output.
---

# Duty Review Skill

Use this skill when the `duty-review` executable runs from the matching duty.

Runtime state is owned by the engine and the duty stage template. Do not ask the duty author to configure raw state keys.

## Method

Review one duty from `.kody/duties/` per tick. This is a design and evidence
review, not a live execution. The goal is to catch duties that no longer fit the
current structure.

## Current Duty Shape

A healthy duty is short and has:

- frontmatter with `staff`, `stage`, and `executables`
- a clear `Job`
- a small `Executable` section
- output and safety limits
- no raw state schema
- no shell recipe or long prompt

The executable should hold the method:

- `.kody/executables/<slug>/profile.json`
- `.kody/executables/<slug>/prompt.md`
- `.kody/executables/<slug>/skills/<skill>/SKILL.md`
- optional executable-owned `*.sh` scripts only when real scripts exist

## Tick Procedure

1. Resolve the repo with `gh repo view --json nameWithOwner -q .nameWithOwner`.
2. List `.kody/duties/*.md`, sorted by slug, excluding `duty-review`.
3. Pick the next slug from runtime state. If the cycle is complete, post a short cycle summary and reset the reviewed list.
4. Read the selected duty, its named executable folder, and recent runtime evidence:
   - duty frontmatter and body
   - executable `profile.json`
   - executable `prompt.md`
   - executable skills and scripts
   - report file, when the duty declares or clearly writes one
   - state/history if the engine exposes it
5. Post a finding only when the duty is `BROKEN` or `WARN`.

## Review Checklist

- **Goal clarity:** The duty has one concrete, checkable job.
- **Frontmatter:** `staff`, `stage`, and `executables` are present and point to real repo objects.
- **Executable wiring:** The executable exists, has valid JSON, has a tiny prompt, and loads at least one skill unless it is deterministic.
- **State model:** The duty does not define raw state keys or require the author to paste a state block. Runtime state belongs to the engine/stage/executable.
- **No command recipe in duty:** Bash, `gh`, Python, and long step-by-step logic belong in executable skills or executable-owned scripts.
- **Output path:** Reports go under `.kody/reports/`; durable human guidance goes under `.kody/context/`; hidden cursors stay in runtime state.
- **Observed behavior:** For enabled duties, recent state/report/activity should roughly match the declared cadence. Disabled duties are reviewed for design only.
- **One-action limit:** The method should not spam many comments, issues, or commits in one tick unless the executable explicitly batches a report write.

## Allowed Commands

- `gh repo view`
- `gh api` reads for `.kody/duties`, `.kody/executables`, `.kody/reports`, and state/history when available
- `gh issue list`, `gh issue create`, and `gh issue comment` only for the Kody duty review tracking issue

## Restrictions

- Read-only on reviewed duties and executables.
- Do not fix the duty being reviewed.
- Do not re-kick or relabel work.
- One reviewed duty per tick.
- One tracking issue comment at most per tick.
