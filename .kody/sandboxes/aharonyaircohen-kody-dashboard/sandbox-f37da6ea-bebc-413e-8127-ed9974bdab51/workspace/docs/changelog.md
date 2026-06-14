# The changelog as state

`CHANGELOG.md` in the connected repo is not hand-maintained — it is a
**machine-written ledger** that the dashboard appends to on every merge,
promotes on every release, and that the QA duty annotates with verdict
markers. There is no separate database of "what shipped" or "what's been
tested": the bullets under `## [Unreleased]`, and the marker on each one,
**are** that state.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Every notable change is one bullet. A merged PR adds a bullet; a published
release rolls the whole `## [Unreleased]` block into a dated version section.
The QA engineer never re-touches an entry once it carries a `✅`/`⚠️` marker —
the marker swap is what stops re-processing. See [./qa.md](./qa.md) for the
QA-duty side of this.

## The pieces

| Piece                        | What it is                                                                                                                                                                      | Where                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `## [Unreleased]` **bullet** | One merged PR, formatted `- <title> ([#<pr>](<url>)) — @<author>`, optionally suffixed with a QA marker joined by `·`. Idempotent on PR number.                                 | [`../CHANGELOG.md`](../CHANGELOG.md)                                                                         |
| **QA marker**                | The authoritative per-PR QA state — none / `🔄` / `✅` / `⚠️` — written by the `qa` duty, never by the append handler.                                                          | trailing segment of each bullet                                                                              |
| **Append handler**           | On `pull_request closed + merged`, inserts a bullet at the top of `## [Unreleased]`. Fire-and-forget; never marks QA.                                                           | [`../src/dashboard/lib/changelog/handlers.ts`](../src/dashboard/lib/changelog/handlers.ts)                   |
| **Promote handler**          | On `release published`, renames `## [Unreleased]` → `## [<version>] - <date>` and inserts a fresh empty Unreleased above. No-op on draft/prerelease or an empty section.        | [`../src/dashboard/lib/changelog/handlers.ts`](../src/dashboard/lib/changelog/handlers.ts)                   |
| **Pure transforms**          | `appendUnreleasedEntry` / `promoteUnreleased` / `formatEntry` — no I/O, idempotent, the entire format spec lives here.                                                          | [`../src/dashboard/lib/changelog/format.ts`](../src/dashboard/lib/changelog/format.ts)                       |
| **GitHub read/write**        | Contents-API read (with ETag) + read-modify-write with a 409-retry loop for near-simultaneous merges. Server token only (App installation → vault `GITHUB_TOKEN`).              | [`../src/dashboard/lib/changelog/file.ts`](../src/dashboard/lib/changelog/file.ts)                           |
| **Dashboard view**           | Read-only `/changelog` page — renders the file as markdown, "Refresh" + "View on GitHub". The dashboard never writes the changelog from the UI.                                 | [`../src/dashboard/lib/components/ChangelogView.tsx`](../src/dashboard/lib/components/ChangelogView.tsx)     |
| **Version auto-bump**        | A `main`-only pre-commit hook bumps `package.json` patch on every commit. Independent of `CHANGELOG.md`, but the source of the version a release later promotes the section to. | [`../.husky/pre-commit`](../.husky/pre-commit), [`../scripts/bump-version.mjs`](../scripts/bump-version.mjs) |

## The bullet + marker format

Each bullet is one merged PR. The base form, produced by `formatEntry`, is:

```
- <title> ([#<pr>](<pr-url>)) — @<author>
```

The QA duty may append **exactly one** trailing marker, joined to the bullet
with `·`. The marker is the authoritative QA state for that entry:

| State        | Marker                               | Meaning                                                                       |
| ------------ | ------------------------------------ | ----------------------------------------------------------------------------- |
| **untested** | _(none)_                             | Merged, never QA'd. The duty's queue is "oldest bullet with no marker".       |
| **running**  | ` · 🔄 QA (#<tracking>)`             | A `qa-engineer` pass is in flight; `<tracking>` is its issue.                 |
| **verified** | ` · ✅ QA <YYYY-MM-DD>`              | Pass came back PASS. Done — never re-tested.                                  |
| **issues**   | ` · ⚠️ QA <YYYY-MM-DD> (#<finding>)` | Pass came back CONCERNS/FAIL; the tracking issue stays open for the fix goal. |

A `🔄` older than 2h with no report is treated as stuck and stripped back to
untested, so QA never wedges. The marker swap is the _only_ signal that stops
an entry being re-processed — there is no separate ledger.

> **Where the marker is written:** the `qa` duty writes markers directly via
> `gh api -X PUT …/contents/CHANGELOG.md` (engine-side, read-modify-write,
> editing only the trailing marker segment). The dashboard's
> [`format.ts`](../src/dashboard/lib/changelog/format.ts) has **no
> marker-handling code** — it only appends bullets and promotes versions. The
> marker format is owned by the duty body, not by dashboard TypeScript.

## How a bullet is born — the append flow

The append is a **fire-and-forget side effect of the GitHub webhook
receiver**, not a polled job and not something the merge author triggers:

```
┌──────────────────────────┐  pull_request:           ┌────────────────────────────┐
│ PR merged on GitHub      │  closed + merged===true   │ /api/webhooks/github         │
│                          │──────────────────────────▶│ dispatch() → handlePrMerged  │
└──────────────────────────┘                           └──────────────┬───────────────┘
                                                                       │ fire-and-forget
                                                                       ▼
                              ┌────────────────────────────────────────────────────┐
                              │ updateChangelog (read-modify-write, ≤3 tries on 409) │
                              │  read CHANGELOG.md (ETag) → appendUnreleasedEntry    │
                              │  → write back as `chore(changelog): add #<pr>`       │
                              └────────────────────────────┬─────────────────────────┘
                                                           │ idempotent on PR #
                                                           ▼
                                          ┌────────────────────────────┐
                                          │ new bullet under            │
                                          │ ## [Unreleased] (no marker) │
                                          └────────────────────────────┘
```

Key properties, all verified in
[`handlers.ts`](../src/dashboard/lib/changelog/handlers.ts) /
[`route.ts`](../app/api/webhooks/github/route.ts):

- **Fire-and-forget.** The webhook ACKs immediately; a failed or slow GitHub
  write is logged but never thrown, so GitHub doesn't retry the delivery.
- **Server token only.** Writes use `getServerOctokit` → App installation
  token, falling back to the vault `GITHUB_TOKEN` — **never a human PAT**, so
  changelog traffic can't drain (or flag) a polling account.
- **Idempotent.** `appendUnreleasedEntry` short-circuits if a bullet for that
  PR number already exists; a duplicate delivery is a no-op.
- **Concurrency-safe.** `updateChangelog` re-reads the SHA and retries up to 3
  times on a 409 conflict, covering two merges landing within milliseconds.
- **Self-creating.** `ensureUnreleasedSection` builds the Keep-a-Changelog
  scaffold on first write, so the file appears the first time any PR merges.

## How a version is cut — the promote flow

A **published, non-draft, non-prerelease** GitHub release fires
`handleReleasePublished`, which calls `promoteUnreleased`:

1. Rename `## [Unreleased]` → `## [<tag_name>] - <YYYY-MM-DD>` (date from the
   release's `published_at`).
2. Insert a fresh empty `## [Unreleased]` above it.

No-op when the Unreleased section is empty (nothing merged since the last
release) or when that version header already exists (idempotent on re-delivery).
All the QA markers ride along into the versioned section unchanged — the duty
ignores versioned sections, so a shipped version's markers are frozen.

## Version auto-bump (separate machinery)

`CHANGELOG.md` versioning and `package.json` versioning are **two different
mechanisms** that meet only at release time:

- The `package.json` version is bumped by a **`main`-only pre-commit hook**
  ([`../.husky/pre-commit`](../.husky/pre-commit) →
  [`../scripts/bump-version.mjs`](../scripts/bump-version.mjs)): every commit
  on `main` increments the patch and `git add`s `package.json`. The hook bails
  out on non-`main` branches and mid-rebase/merge/cherry-pick.
- The **`CHANGELOG.md` version section** is created later, by the release
  webhook, using the release's `tag_name`.

> **Silent-freeze gotcha:** the bump hook is a shell script that only runs if
> it keeps its execute bit. If `.husky/pre-commit` loses `+x` (e.g. after some
> checkout/restore operations), version bumping **stops silently** — commits
> succeed, the version just stops moving. Fix with `chmod +x .husky/pre-commit`.

## The dashboard view (`/changelog`)

[`/changelog`](../app/changelog/page.tsx) is **read-only**. It renders the
connected repo's `CHANGELOG.md` as markdown (`react-markdown` + `remark-gfm`)
with a Refresh button and a "View on GitHub" link.

- Data comes from `GET /api/kody/changelog`
  ([route](../app/api/kody/changelog/route.ts)), which just reads the file via
  `readChangelog` — there is **no write endpoint**. Every mutation is a
  webhook side effect or an engine `gh` call.
- The hook ([`useChangelog`](../src/dashboard/lib/hooks/useChangelog.ts)) is a
  React Query read with a 30s stale time.
- The QA markers render as **plain text** in the bullets (the `🔄`/`✅`/`⚠️`
  emoji and the `· QA …` suffix); the view does not parse them into badges —
  it shows the raw ledger.
- The page is statically rendered (`dynamic = "force-static"`) and reached
  from the nav entry in
  [`settings-nav.ts`](../src/dashboard/lib/components/settings-nav.ts).

## File reference

| File                                                                                                         | Purpose                                                          |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [`../src/dashboard/lib/changelog/format.ts`](../src/dashboard/lib/changelog/format.ts)                       | Pure transforms — append bullet, promote version, format entry   |
| [`../src/dashboard/lib/changelog/file.ts`](../src/dashboard/lib/changelog/file.ts)                           | Contents-API read/write + read-modify-write with 409 retry       |
| [`../src/dashboard/lib/changelog/handlers.ts`](../src/dashboard/lib/changelog/handlers.ts)                   | Webhook side-effects: `handlePrMerged`, `handleReleasePublished` |
| [`../app/api/webhooks/github/route.ts`](../app/api/webhooks/github/route.ts)                                 | Webhook receiver — dispatches merge → append, release → promote  |
| [`../app/api/kody/changelog/route.ts`](../app/api/kody/changelog/route.ts)                                   | `GET /api/kody/changelog` — read-only fetch for the view         |
| [`../src/dashboard/lib/components/ChangelogView.tsx`](../src/dashboard/lib/components/ChangelogView.tsx)     | Read-only markdown view                                          |
| [`../src/dashboard/lib/hooks/useChangelog.ts`](../src/dashboard/lib/hooks/useChangelog.ts)                   | React Query hook (30s stale)                                     |
| [`../app/changelog/page.tsx`](../app/changelog/page.tsx)                                                     | `/changelog` page entry point                                    |
| [`../.husky/pre-commit`](../.husky/pre-commit), [`../scripts/bump-version.mjs`](../scripts/bump-version.mjs) | `main`-only `package.json` patch bump                            |
| [`../.kody/duties/qa/duty.md`](../.kody/duties/qa/duty.md)                                                             | The duty that writes QA markers (see [./qa.md](./qa.md))         |

## FAQ

**Who writes `CHANGELOG.md`?**

Three machine writers, no humans. The **append handler** adds a bullet on
merge; the **promote handler** cuts a version on release; the **`qa` duty**
swaps the trailing marker. The dashboard view is read-only and there's no
write endpoint.

**Why isn't the merge author the one adding the bullet?**

Because the dashboard reacts to the _merge event_ via webhook, not to a
commit. That keeps the bullet text canonical (PR title + number + author from
the GitHub payload) and means the changelog is correct even if the merge
happened from the GitHub UI with no local tooling.

**What stops a re-tested entry from looping?**

The QA marker. Once a bullet reads `✅`/`⚠️`, the `qa` duty skips it — its
queue is strictly "oldest bullet with no marker". There is no separate
ledger; the marker _is_ the state. See [./qa.md](./qa.md).

**Does the dashboard parse the markers into UI badges?**

No. The view renders the raw markdown, so markers appear as inline text. The
markers are a machine-to-machine contract (duty writes, duty reads); the view
is a human-readable mirror.

**What's the relationship between the version bump and the changelog?**

They're decoupled. `package.json` bumps every `main` commit via a git hook;
`CHANGELOG.md` only gains a version section when a GitHub release is
published. The release's `tag_name` is what the section is named — so the two
agree only if releases are tagged from the bumped version.

**My version stopped bumping — why?**

Almost always the pre-commit hook lost its execute bit. `chmod +x
.husky/pre-commit`. The hook also intentionally no-ops on non-`main` branches
and mid-rebase/merge.

**What happens if two PRs merge at the same instant?**

`updateChangelog` does a read-modify-write and retries up to 3 times on a 409
SHA conflict, re-reading the latest file each round, so both bullets land.
