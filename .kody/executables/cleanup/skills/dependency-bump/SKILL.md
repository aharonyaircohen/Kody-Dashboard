---
name: dependency-bump
description: Track stale production dependencies and keep at most one bump PR in flight.
---

# Dependency Bump Skill

Use this skill when the `dependency-bump` executable runs from the matching duty.

Runtime state is owned by the engine. Do not ask the duty author to configure raw state keys.

## Method

## Job

Weekly tracking of stale production dependencies. One bump PR in flight at a time — never let bumps pile up.

**Per tick (one action max):**

1. Check current in-flight tracking issue: `gh issue list --label "kody:deps-bump" --state open --json number,title,createdAt,body`.
2. If an open issue exists AND was created less than 7 days ago, emit `cursor: awaiting-pr` and exit (last week's bump is still being processed).
3. If the open issue is older than 7 days with no merged PR linking it, post one nudge comment:
   ```
   gh issue comment <n> --body "Last week's bump appears stalled. /kody chore: drop or unblock this bump and pick the next stalest package."
   ```
   Then exit.
4. Otherwise, open the new tracking issue:
   ```
   gh issue create \
     --title "deps: weekly bump $(date -u +%Y-%m-%d)" \
     --label "kody:deps-bump" \
     --body "/kody chore: run \`pnpm outdated --prod --json\`, pick the SINGLE most-stale package (largest semver gap; ties broken by oldest published date), and open one PR that bumps it (and the matching @types/* if any). Skip packages already attempted in the last 30 days — see history below.\n\nHistory: <data.history serialized as a list of {pkg, attemptedISO, outcome}>\n\nIf the chosen package has been attempted before, document why this attempt is different (new compatible version? upstream regression resolved?). If nothing eligible to bump, comment 'no eligible packages' and close."
   ```
5. Stash `data.openIssue` and append `{ pkg: "<chosen-by-executor>", attemptedISO: <now>, outcome: "in-flight" }` to `data.history` (you don't know the package yet — leave `pkg: null` and let a future tick correlate it from the eventual PR title).

## Allowed Commands

- `gh issue list`, `gh issue create`, `gh issue comment`
- `gh pr list --search "label:kody:deps-bump"` (to correlate package names back into history)

## Restrictions

- Never edit files. Never run `pnpm`. Delegation via `/kody chore` only.
- One bump in flight at a time — that's the whole point.
- Maximum one issue created or commented per tick.
- If `gh issue create --label kody:deps-bump` fails because the label doesn't exist, run `gh label create kody:deps-bump --description "Kody job: dependency bump"` and retry the create. **Do not skip the label** — the next-tick "is bump in flight?" check depends on it.
- `data.history` must not exceed 50 entries — drop the oldest when over.
