---
every: 1d
staff: tech-writer
mentions: aguyaharonyair
disabled: true
---

# Docs Drift — README / markdown

## Job

Catch the case where a **merged PR changed a documented feature but didn't
update its doc**, and recommend the doc update to the inbox. This is the
per-PR, targeted half of doc maintenance (the broad code-header half is
[`docs-code.md`](./docs-code.md)). It writes nothing itself — it flags drift
and lets the operator approve the actual edit.

`disabled: true` until the area→doc map below is confirmed against the live
`docs/` tree and the dispatch verb is verified in the engine README. Flip to
`disabled: false` once both are checked.

**Cursor.** `data.lastCheckedMergedAt` is an ISO timestamp — the high-water
mark of merged PRs already inspected. The first run with no cursor set should
record "now" and exit (don't retro-scan history).

**Per tick (catch up on every PR merged since the cursor):**

1. List recently merged PRs newest-first:
   `gh pr list --state merged --base main --json number,title,mergedAt,files --limit 30`
2. Take **every** PR whose `mergedAt > data.lastCheckedMergedAt`, oldest-first
   (a daily tick may cover several merges). If none, idle (emit unchanged
   state, exit). Process each in turn, then advance the cursor once at the end.
3. For each PR, map its changed `files[].path` to documented areas using the table below.
   - If the PR touched **no** documented area → nothing to flag; move to the
     next PR.
   - If it touched a documented area **and also changed the mapped
     `docs/*.md`** in the same PR → the author already updated the doc; move on.
   - If it touched a documented area but **left the doc untouched** → that's
     drift. Do step 4 for it, then move to the next PR.
4. Dedup, then flag (one issue + one inbox rec per drifted area):
   - Title: `docs-drift: <docPath> (#<pr>)`. If an open issue with that title
     already exists
     (`gh issue list --label kody:docs --state open --json number,title --limit 50`),
     skip — already tracked.
   - Otherwise open a tracking issue (create the label first if missing —
     `gh label create kody:docs --description "Kody: documentation drift"` —
     never skip the label):
     ```
     gh issue create --title "docs-drift: <docPath> (#<pr>)" --label kody:docs \
       --body "<see body template>"
     ```
   - Post one inbox recommendation (format below).
5. After all PRs are processed, advance `data.lastCheckedMergedAt` to the
   **newest** processed PR's `mergedAt` (one write, at the end).

### Area → doc map

The dedup and flagging key is the mapped doc path. Extend this table as docs
are added; an area with no doc maps to nothing (handled by `docs-code`'s
gap sweep instead, not here).

| Changed path prefix                              | Doc                              |
| ------------------------------------------------ | -------------------------------- |
| `src/dashboard/lib/inbox/`, `src/dashboard/lib/cto/` | `docs/inbox.md`              |
| `src/dashboard/lib/tasks/`, `app/api/kody/tasks/`    | `docs/tasks.md`              |
| `src/dashboard/lib/runners/`, `src/dashboard/lib/health/` | `docs/runners.md`       |
| `src/dashboard/lib/vibe/`, `src/dashboard/lib/voice/`, `src/dashboard/lib/picker/` | `docs/vibe-and-voice.md` |
| `src/dashboard/lib/activity/`                    | `docs/activity.md`               |
| `src/dashboard/lib/executables/`                 | `docs/executables.md`            |
| `src/dashboard/lib/company/`                     | `docs/company.md`                |
| `src/dashboard/lib/context/`                     | `docs/context.md`                |
| `src/dashboard/lib/engine/`                      | `docs/engine-config.md`          |
| `src/dashboard/lib/messages/`, `src/dashboard/lib/mentions/` | `docs/messages-and-mentions.md` |
| `src/dashboard/lib/changelog/`                   | `docs/changelog.md`              |
| `src/dashboard/lib/commands/`                    | `docs/commands.md`               |
| `src/dashboard/lib/vault/`                       | `docs/secrets-vault.md`          |
| `src/dashboard/lib/notifications/`, `src/dashboard/lib/push/` | `docs/notifications.md` |
| `src/dashboard/lib/webhooks/`                    | `docs/webhooks.md`               |

### Issue body template

```
A merged PR changed code under a documented area, but its doc was not updated
in the same PR — the doc may now be stale.

- **PR:** #<pr> — <title>
- **Documented area touched:** `<path prefix>`
- **Doc that likely needs updating:** [`<docPath>`](../<docPath>)
- **Changed files in that area:** <files joined as `code, code, code`>

A human or coding agent reading `<docPath>` would now get an out-of-date
picture. On approval, the writer should read the PR diff, reconcile the doc,
and open a PR with the update — or close this issue with a comment if the
change was doc-irrelevant (internal refactor, no behavior change).
```

## Inbox recommendation format

One comment, terse. It **MUST** `@`-mention the operator on the first line —
that mention is the only thing that routes it into the dashboard inbox:

```
{{mentions}} 📝 **Docs may be stale** — `update`

PR #<pr> changed `<area>` but didn't touch [`<docPath>`](../<docPath>).
Approving dispatches a doc-update PR; dismiss if the change was doc-irrelevant.

<!-- kody-cmd: @kody chore --issue <tracking> -->

_Confirm or dismiss in the dashboard inbox. The writer will not edit docs on its own._
```

On approve, the Approve button posts the `kody-cmd` line verbatim, so it MUST
be one line, ≤ 300 chars, and name a real engine verb. **Verify `chore --issue`
in the engine README before enabling this duty** (per the persona's hard rule);
if the engine takes a different form for "open a PR from this issue", use that
form here instead. Never emit `@kody approve` — the engine has no `approve`
verb.

## Allowed Commands

- `gh pr list`, `gh pr view`.
- `gh issue list`, `gh issue create`, `gh issue comment`, `gh label create`.

## Restrictions

- **Advisory only.** Never edit, commit, or push a doc; never open a PR; never
  merge/approve/label a PR. You flag and recommend — the operator approves the
  edit, the engine writes it.
- **Catch up on all PRs merged since the cursor** each tick (batch — it's
  light bookkeeping), **one issue + one rec** per drifted area.
- **Dedup by tracking-issue title** (`docs-drift: <docPath> (#<pr>)`); skip if
  an open one already exists.
- **Never retro-scan**: the first run sets the cursor to "now" and exits. Only
  PRs merged after the cursor are ever inspected.
- All writes go through `gh` — never `git commit`/`git push`.

## State

- `cursor`: `idle` | `flagged`.
- `data.lastCheckedMergedAt`: ISO timestamp high-water mark of inspected merged
  PRs. Authoritative anti-re-scan guard. Set to "now" on the first ever run.
- `data.nextEligibleISO`: always emit — surfaced as "next run" on the dashboard.
- `done`: always `false` — doc maintenance is evergreen.
