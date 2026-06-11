---
name: qa-sweep
description: Run broad exploratory QA against the live app and summarize actionable findings.
---

# QA Sweep Skill

Use this skill when the `qa-sweep` executable runs from the matching duty.

Runtime state is owned by the engine and the duty stage template. Do not ask the duty author to configure raw state keys.

## Method

## Job

Periodic **broad exploratory QA** of the whole app — no scenario, no scope.
Delegates to the `qa-engineer` executable with **no `--scope`**, so it smoke-tests
every discovered route against the live deployment, then summarizes the result
to the inbox. This catches regressions and rough edges in already-shipped
features that the changelog-verification duty (which only tests _new_ entries)
never revisits.

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

<!-- kody-cmd: @kody qa-goal --issue <tracking> --scope "sweep" -->

_Confirm or dismiss in the dashboard inbox. QA will not act on its own._
```

`<action>` is `fix` when the sweep opened findings, or `note` for a clean
sweep. **On findings**, the `kody-cmd` is
`@kody qa-goal --issue <tracking> --scope "sweep"` — qa-engineer already posted
the sweep report on the tracking issue; on approve, `qa-goal` promotes it into
a fix goal (one ticket per finding). **On a clean sweep, omit the `kody-cmd:`
line** — it's informational; the operator just dismisses. **Never emit
`@kody approve`** — the engine has no `approve` verb. QA never creates the goal
itself; it's gated behind your approval.

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
