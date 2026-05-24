---
every: 30m
staff: qa
mentions: aguyaharonyair
disabled: true
---

# QA Changelog Verification

## Job

Verify every shipped-but-unverified scenario in `CHANGELOG.md` against the live
app, and record the verdict **back into the changelog** — the changelog *is*
this job's state. Each `## [Unreleased]` bullet (one per merged PR) carries a
trailing QA marker, appended after the `— @author`, joined by ` · `:

| State        | Marker                          |
| ------------ | ------------------------------- |
| **untested** | _(none)_                        |
| **running**  | ` · 🔄 QA (#<tracking>)`        |
| **verified** | ` · ✅ QA <YYYY-MM-DD>`          |
| **issues**   | ` · ⚠️ QA <YYYY-MM-DD> (#<n>)`   |

Browsing is delegated to the `qa-engineer` executable (the job runs no browser
itself); the job opens a tracking issue, dispatches the run onto it, and reads
the verdict back on a later tick. **One run in flight at a time** — this bounds
browser cost.

`disabled: true` until a browser auth profile exists. The dashboard is
PAT-gated; without saved auth (`.kody/qa-guide.md` + a Playwright
`storageState.json`) every run just hits a login wall. Flip to
`disabled: false` once that's in place, and replace `<PROD_URL>` below with the
live dashboard URL.

**Per tick (one action max):**

1. Read the Unreleased section once:
   `gh api repos/{owner}/{repo}/contents/CHANGELOG.md --jq '.content' | base64 --decode`
   — take only the bullets between `## [Unreleased]` and the next `## [`.
   Ignore versioned sections (they shipped before QA existed).

2. **If a bullet is marked `🔄 QA (#n)`** (a run is in flight) → read its
   tracking issue: `gh issue view <n> --json state,title,comments,labels,createdAt`.
   - **No `qa-engineer` report yet, issue < 2h old** → emit unchanged state, exit.
   - **Report present** → read the verdict (`QA [PASS|CONCERNS|FAIL]` title or
     `kody:qa-report` label — do not free-text guess):
     - **PASS** → swap the marker to ` · ✅ QA <today>`, close the tracking
       issue, post one **informational** inbox rec (already shipped — clear to
       ship, so it carries **no** `kody-cmd:` line; the operator just dismisses).
     - **CONCERNS / FAIL** → swap the marker to ` · ⚠️ QA <today> (#<finding>)`,
       close the tracking issue, post one inbox rec whose `kody-cmd:` is
       `@kody fix <one-line concern> (#<finding>)` — never `@kody approve`.
   - **Stuck** (no report, issue ≥ 2h old) → strip the marker (back to
     untested), comment the stall on the tracking issue, exit. A `🔄` must never
     block QA forever.

   Exit after resolving — the changelog write is your single mutation this tick.

3. **Else (nothing in flight)** → pick the **oldest untested** bullet: the
   bottom-most one with a `[#<pr>]` link and no marker. If none, idle. For it:
   1. Open a tracking issue:
      `gh issue create --title "QA: <title> (#<pr>)" --label kody:qa --body "Automated QA pass for changelog entry #<pr>; qa-engineer reports here."`
   2. Dispatch the pass onto it (pass `--url` explicitly — there's no goal
      branch to resolve from):
      `gh issue comment <tracking> --body "@kody qa-engineer --url <PROD_URL> --scope \"<title>\" --issue <tracking>"`
   3. Mark the bullet ` · 🔄 QA (#<tracking>)` via a read-modify-write PUT to the
      Contents API (re-read the sha, swap the one line, retry ≤ 3 on 409):
      `gh api -X PUT repos/{owner}/{repo}/contents/CHANGELOG.md -f message="chore(qa): start QA for #<pr>" -f content="<base64>" -f sha="<sha>"`.
      Never rewrite any line other than that bullet's trailing marker.

## Inbox recommendation format

One comment, terse. It **MUST** `@`-mention the operator on the first line —
that mention is the only thing that routes it into the dashboard inbox:

```
{{mentions}} 🧪 **QA result** — `<action>`

<one or two sentences: what was tested, the verdict, what confirming does>

<!-- kody-cmd: @kody fix <one-line concern> (#<finding>) -->

_Confirm or dismiss in the dashboard inbox. QA will not act on its own._
```

`<action>` is `verified` (PASS — clear to ship) or `fix` (CONCERNS/FAIL).

- **PASS → omit the `kody-cmd:` line entirely.** The change already shipped, so
  there is nothing for the engine to run; the rec is informational and the
  operator just dismisses it.
- **CONCERNS / FAIL → the `kody-cmd:` line is required and MUST be a real engine
  verb:** `@kody fix <one-line concern>` (optionally `--pr <n>`). The Approve
  button posts it verbatim, so it MUST start with `@kody fix`, be one line,
  ≤ 300 chars. **Never emit `@kody approve`** — the engine has no `approve`
  verb and rejects it.

## Allowed Commands

- `gh api repos/{owner}/{repo}/contents/CHANGELOG.md` (read + `-X PUT` to write
  **only** a bullet's trailing marker).
- `gh issue list`, `gh issue create`, `gh issue view`, `gh issue comment`,
  `gh issue close`.

## Restrictions

- **Advisory on outcomes.** Dispatching `qa-engineer` is read-only (it never
  commits). The `fix` rec is a recommendation only — never merge, approve a
  PR/review, label, or run a fix yourself.
- **One run in flight at a time.** If any bullet shows `🔄`, never start a
  second run this tick.
- **Changelog: markers only.** Edit solely the trailing ` · 🔄/✅/⚠️ …` segment.
  Never change entry text, reorder bullets, promote versions, or touch a
  versioned section.
- **One inbox recommendation per result**, only when a run resolves (step 2).
  The marker swap to ✅/⚠️ is what stops the same entry being re-processed.
- All writes go through `gh` — never `git commit`/`git push`, never open a PR.

## State

The **changelog markers are the state** — no separate ledger.

- `cursor`: always `idle` (state is per-bullet in the changelog, not global).
- `data.inflightPr`: number | null — mirror of the entry currently marked `🔄`,
  a consistency guard against a half-written tick. The changelog marker is
  authoritative.
- `data.nextEligibleISO`: always emit — surfaced as "next run" on the dashboard.
- `done`: always `false` — QA is evergreen.
