# Docs Coverage — in-code / folder headers

## Job

Periodic **broad sweep for in-code documentation gaps** — important folders
with no header explaining their purpose, or modules missing the `@ai-summary`
header the rest of the codebase uses. This is the slow, broad half of doc
maintenance (the per-PR markdown half is [`docs-readme.md`](./docs-readme.md)).
It catches the legibility gaps that no single PR triggers — folders that have
quietly grown without a "start here" note. It recommends the fix; it writes
nothing itself.

`disabled: true` until the coverage heuristic below is confirmed and the
dispatch verb is verified in the engine README. Flip to `disabled: false` once
both are checked.

**Cadence guard.** A full coverage sweep is broad and noisy if run too often.
If `data.lastRunISO` is set and within the last 24 hours, emit unchanged state
and exit. Otherwise proceed and set `data.lastRunISO` to now (UTC ISO).
(`every: 1d` is the cadence; the 24h guard is just a backstop against an extra
early wake.)

**One finding flagged per tick** — pick the single worst-covered folder, not a
batch. Doc-coverage debt is paid down one folder at a time so the inbox isn't
flooded.

**Per tick (one action max):**

1. List the important feature folders and their file count:
   `for d in src/dashboard/lib/*/; do echo "$d $(ls "$d"*.ts "$d"*.tsx 2>/dev/null | wc -l)"; done`
   (Skip `components/` and `utils/` — too broad and too generic to usefully
   header at the folder level.)
2. For each folder, judge coverage with `gh` + Read:
   - **Folder header present?** Read the folder's most-central file (the one
     matching the folder name, or `index.ts`); does its top carry an
     `@ai-summary` / purpose header?
   - **Module coverage:** roughly what fraction of the folder's `.ts`/`.tsx`
     files carry an `@ai-summary` header.
     A folder is **under-documented** if it has ≥ 4 source files and either no
     central header or < ~half its modules carry a summary.
3. Pick the **single worst** under-documented folder not already tracked
   (`gh issue list --label kody:docs-coverage --state open --json number,title --limit 50`;
   dedup key is the folder path in the title). If none qualify, idle.
4. Open a tracking issue (create the label first if missing —
   `gh label create kody:docs-coverage --description "Kody: in-code doc coverage gap"` —
   never skip the label) and post one inbox rec (format below).

### Issue body template

```
This folder is a load-bearing feature area with little in-code documentation,
so a coding agent reading it cold has to infer purpose by grepping across
files.

- **Folder:** `<folder>`
- **Source files:** <count>
- **Central header (`@ai-summary` on the index/main file):** present | missing
- **Modules carrying `@ai-summary`:** <n>/<count>

On approval, the writer should add a concise folder-level header to the
central file (what this folder is, the entry point, and any load-bearing
gotcha) and `@ai-summary` headers to the modules that lack one — capturing the
*why* and the *trap*, never restating what the code says. Open a PR with the
additions.
```

## Inbox recommendation format

One comment, terse. It **MUST** `@`-mention the operator on the first line —
that mention is the only thing that routes it into the dashboard inbox:

```
{{mentions}} 📂 **Doc-coverage gap** — `document`

`<folder>` (<count> files) has thin in-code docs — an agent reading it cold
must grep to learn its purpose. Approving dispatches a PR adding headers.

<!-- kody-cmd: @kody chore --issue <tracking> -->

_Confirm or dismiss in the dashboard inbox. The writer will not edit code on its own._
```

On approve, the Approve button posts the `kody-cmd` line verbatim, so it MUST
be one line, ≤ 300 chars, and name a real engine verb. **Verify `chore --issue`
in the engine README before enabling this duty** (per the persona's hard rule);
use whatever form the engine actually takes for "open a PR from this issue".
Never emit `@kody approve` — the engine has no `approve` verb.

## Allowed Commands

- Shell listing of `src/dashboard/lib/*/` for the file-count pass; Read tool to
  inspect file headers.
- `gh issue list`, `gh issue create`, `gh issue comment`, `gh label create`.

## Restrictions

- **Advisory only.** Never edit, commit, or push code; never open a PR; never
  merge/approve/label. You flag and recommend — the operator approves, the
  engine writes the headers.
- **One folder flagged per tick**, and at most **one** issue + one rec.
- **Daily** (`every: 1d`); the 24h `data.lastRunISO` guard is a backstop.
- **Dedup by tracking-issue title** (folder path); skip if an open one exists.
- Skip `components/` and `utils/` — folder-level headers there aren't useful.
- All writes go through `gh` — never `git commit`/`git push`.

## State

- `cursor`: `idle` | `flagged`.
- `data.lastRunISO`: ISO timestamp of the last tick that flagged a folder.
- `data.nextEligibleISO`: always emit — `data.lastRunISO + 24h`. Surfaced as
  "next run" on the dashboard.
- `done`: always `false` — doc coverage is evergreen.
