---
name: duty-call
description: Propose one high-ROI missing duty the system does not already have.
---

# Duty Call Skill

Use this skill when the `duty-call` executable runs from the matching duty.

Runtime state is owned by the engine. Do not ask the duty author to configure raw state keys.

## Method

Propose one useful missing duty. The proposal is advisory only: create a GitHub
issue with the reason, score, suggested duty profile fields, and any executable or
skill that would be needed. Do not write the duty folder yourself.

## Candidate Rules

- Read `.kody/duties/` first; never propose a duty that already exists.
- Read `.kody/memory/` for prior rejected or dismissed proposals.
- Never re-propose a rejected slug.
- Respect dismissed slugs until their cooling-off window expires.
- Prefer gaps that can be expressed as a simple duty plus executable.

## Proposal Shape

The issue should include:

- proposed duty slug
- staff owner
- cadence
- stage template
- executable slug
- expected report/comment/output
- safety limits
- why this duty is worth adding now

## Tick Procedure

1. Gather existing duties, staff, executables, reports, and memories.
2. Build a small candidate list of missing recurring responsibilities.
3. Score each candidate by impact, confidence, noise risk, and implementation cost.
4. Pick the best candidate that has not been rejected or recently dismissed.
5. If no candidate is strong enough, do nothing.
6. Otherwise create one proposal issue labeled `kody:ceo-proposal`.
7. Record the proposed slug in runtime state so it is not proposed again while open.

## Allowed Commands

- `gh api` reads for `.kody/duties`, `.kody/staff`, `.kody/executables`, `.kody/reports`, and `.kody/memory`
- `gh issue list`
- `gh issue create`
- `gh label create` when the proposal label is missing

## Restrictions

- One proposal per tick.
- Never create or edit duty folders.
- Never create or edit executables.
- Never re-surface rejected proposals.
- Better to stay quiet than propose low-signal work.
