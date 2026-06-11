---
name: flaky-test-quarantine
description: Watch CI retry patterns and escalate tests that repeatedly fail then pass on rerun.
---

# Flaky Test Quarantine Skill

Use this skill when the `flaky-test-quarantine` executable runs from the matching duty.

Runtime state is owned by the engine and the duty stage template. Do not ask the duty author to configure raw state keys.

## Method

## Job

Detect and quarantine flaky tests by watching CI failure patterns on `dev` and `main`.

**Per tick (one action max):**

1. Fetch the last 50 completed CI runs on `dev` and `main`:
   `gh run list --branch dev --limit 25 --json databaseId,headSha,conclusion,workflowName,createdAt,attempt`
   `gh run list --branch main --limit 25 --json databaseId,headSha,conclusion,workflowName,createdAt,attempt`
2. Identify **flip candidates** — runs where the same `headSha` had at least one failed attempt followed by a successful re-run (`attempt > 1` with prior `conclusion=failure`). For each, fetch failed jobs:
   `gh run view <runId> --json jobs` and pull failed test names from job logs via `gh api repos/{owner}/{repo}/actions/jobs/<jobId>/logs` (parse the vitest/playwright failure lines).
3. Update `data.candidates[testId] = { flips, lastSeenSha, lastSeenISO }`. Only count one flip per (testId, headSha) pair.
4. **Quarantine threshold:** when a candidate reaches `flips >= 3` AND has not yet been escalated, post **one** issue (one per tick — pick the highest-flip candidate not yet escalated):
   ```
   gh issue create \
     --title "flaky: <testId>" \
     --label "kody:flaky-test" \
     --body "Detected $flips flips across recent CI runs. Latest SHAs: <list>. /kody fix: quarantine this test by marking it .skip with a TODO citing this issue, then open a PR."
   ```
   Mark `data.candidates[testId].escalated = true` and stash `data.candidates[testId].issue = <number>`.
5. **Garbage-collect** candidates whose `lastSeenISO` is older than 14 days — delete them from `data.candidates`.

If no candidates cross the threshold this tick, just narrate briefly (no comment needed) and emit state.

## Allowed Commands

- `gh run list`, `gh run view`
- `gh api repos/{owner}/{repo}/actions/jobs/<id>/logs`
- `gh issue list`, `gh issue create`, `gh issue comment`

## Restrictions

- Never edit, create, or delete files in the working tree.
- Never push, never commit.
- Maximum **one** new issue per tick. Other candidates wait for the next tick.
- Skip a candidate if an open issue with `label:kody:flaky-test` and the testId in the title already exists.
- Do NOT escalate the same testId twice — `data.candidates[testId].escalated` gates re-fire.
