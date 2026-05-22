---
staff: qa
mentions: aguyaharonyair
every: 1h
disabled: true
---

# QA Sweep

## Job

Periodic **broad exploratory QA** of the whole app — no scenario, no scope.
Delegates to the `qa-engineer` executable with **no `--scope`**, so it smoke-tests
every discovered route against the live deployment, then summarizes the result
to the inbox. This catches regressions and rough edges in already-shipped
features that the changelog-verification duty (which only tests *new* entries)
never revisits.

`disabled: true` until a browser auth profile exists — same blocker as the
changelog QA duty: the dashboard is PAT-gated, so without `.kody/qa-guide.md` +
a Playwright `storageState.json` every run just hits a login wall. Replace
`<PROD_URL>` below with the live dashboard URL, then flip to `disabled: false`.

**Cadence guard.** A full sweep is the most expensive QA run. If
`data.lastRunISO` is set and within the last 24 hours, emit unchanged state and
exit. Otherwise proceed and set `data.lastRunISO` to now (UTC ISO). (`every: 1h`
just wakes it; the guard makes it sweep ~once/day.)

**One run in flight at a time.**

**Per tick (one action max):**

1. Check for an open sweep tracking issue:
   `gh issue list --label "kody:qa-sweep" --state open --json number,title,createdAt,comments`
2. **Open, created < 2h ago** → emit `cursor: awaiting-result` and exit (sweep
   in flight; don't double-trigger).
3. **Open, with a `qa-engineer` report present** → post one inbox rec
   summarizing the sweep (verdict + finding count, links to the findings),
   close the tracking issue, clear `data.openIssue`.
4. **Open, ≥ 2h old, no report** → comment the stall, close it, clear state
   (the next eligible tick re-runs). A stuck sweep must never wedge the duty.
5. **Otherwise** (cadence guard passed, none open) → open a tracking issue and
   dispatch with no scope:
   ```
   gh issue create --title "QA sweep $(date -u +%Y-%m-%d)" --label kody:qa-sweep \
     --body "Automated broad QA sweep; qa-engineer reports here."
   gh issue comment <n> --body "@kody qa-engineer --url <PROD_URL> --issue <n>"
   ```
   Set `data.openIssue = <n>` and `data.lastRunISO = now`.

## Inbox recommendation format

One comment, terse. It **MUST** `@`-mention the operator on the first line —
that mention is the only thing that routes it into the dashboard inbox:

```
{{mentions}} 🧹 **QA sweep** — `<action>`

<one or two sentences: routes covered, verdict, finding count>

<!-- kody-cmd: @kody <exact command to run on approve> -->

_Confirm or dismiss in the dashboard inbox. QA will not act on its own._
```

`<action>` is `fix` when the sweep opened findings (the `kody-cmd` triages
them), or `note` for a clean sweep (no command needed — informational).

## Allowed Commands

- `gh issue list`, `gh issue create`, `gh issue view`, `gh issue comment`,
  `gh issue close`.

## Restrictions

- **Advisory only.** Dispatching `qa-engineer` is read-only. Never merge,
  approve, fix, or label PRs yourself — surface, the operator confirms.
- **One sweep in flight**, and at most **one** issue action per tick.
- If `gh issue create --label kody:qa-sweep` fails because the label is missing,
  run `gh label create kody:qa-sweep --description "Kody: broad QA sweep"` and
  retry — the in-flight check depends on the label.
- All writes go through `gh` — never `git commit`/`git push`, never open a PR.

## State

- `cursor`: `idle` | `awaiting-result`.
- `data.lastRunISO`: ISO timestamp of the last tick that dispatched a sweep.
- `data.openIssue`: number of the current sweep tracking issue (or null).
- `data.nextEligibleISO`: always emit — `data.lastRunISO + 24h`. Surfaced as
  "next run" on the dashboard.
- `done`: always `false` — QA is evergreen.
