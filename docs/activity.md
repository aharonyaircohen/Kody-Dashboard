# Activity / audit timeline

The dashboard ships an **Activity** page that answers "who did what, and is
the engine healthy?" for the connected repo. It is **dashboard-owned**: there
is no shared engine type for "an action happened" — the page merges up to
**three independent sources**, each living somewhere on GitHub (GitHub is the
broker, not a database), and folds them into one read-only timeline. It never
acts; it only reports.

The page has four tabs, and they answer different questions because they read
different sources:

- **Log** — _what did a human do in the dashboard?_ (approvals, edits, vault writes)
- **Auto** — _what did the engine do on its own?_ (which agent ran which capability, and the result)
- **Runs** — _is the engine healthy, jammed, or looping?_ (kody.yml workflow-run health)
- **Feed** — _what happened inside a chat/run session?_ (per-session engine + chat event stream)

The honest caveat up front: **attribution — tying one action to the one human
or capability that triggered it — is the hard, partial glue.** Each source carries
_some_ of the picture (the Log has a verified actor; Auto has agent+capability; Runs
guess the `@kody` action from a label; Feed guesses the initiator from the
first message), but nothing stitches them into a single "this person caused
this run caused these events" thread. That unification is a deliberate
follow-up, not what a current page does — see [Attribution](#attribution-the-missing-glue).

## The pieces

| Piece                    | What it is                                                                                                                              | Where                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Log** tab              | Dashboard actions a verified human took (capability runs/edits, task actions, vault writes, agent/prompt/goal changes), newest-first.         | [`../src/dashboard/lib/activity/audit.ts`](../src/dashboard/lib/activity/audit.ts) (`recordAudit`) |
| **Auto** tab             | Company Activity — named, attributed engine actions (which agent ran which capability, why, and the outcome). Engine-authored.                | [`../src/dashboard/lib/activity/company.ts`](../src/dashboard/lib/activity/company.ts)             |
| **Runs** tab             | kody.yml workflow-run health: queue depth, flood detector, median duration, plus the `@kody` action joined from each run's issue label. | [`../src/dashboard/lib/activity/snapshot.ts`](../src/dashboard/lib/activity/snapshot.ts)           |
| **Feed** tab             | One row per chat/run **session**, grouped from the engine's per-session event files; expand for the raw event payloads.                 | [`../src/dashboard/lib/activity/feed.ts`](../src/dashboard/lib/activity/feed.ts)                   |
| `recordAudit(req, spec)` | The one call sites use to log a dashboard action. Resolves the **verified** actor from the request PAT, not the client-claimed login.   | [`../src/dashboard/lib/activity/audit.ts`](../src/dashboard/lib/activity/audit.ts)                 |
| `actionFromLabels`       | Pure map from a run's issue `kody:*` phase label → the `@kody` command behind it. **Changing those labels changes what Runs shows.**    | [`../src/dashboard/lib/activity/action.ts`](../src/dashboard/lib/activity/action.ts)               |

## The three sources (and where each lives)

There is no engine→dashboard event bus. Each tab reaches into a different
GitHub-stored artifact, all in the connected repo:

| Source                  | Lives in                                                   | On branch            | Written by                                        | Read by                                    |
| ----------------------- | ---------------------------------------------------------- | -------------------- | ------------------------------------------------- | ------------------------------------------ |
| **Dashboard audit log** | `kody:audit-log` manifest issue body (a bounded JSON ring) | _(issue, no branch)_ | the dashboard, via `recordAudit`                  | `/api/kody/activity/log` (Log tab)         |
| **Company activity**    | `.kody/activity/<date>.jsonl`                              | `kody-state`         | the **engine** (`appendCompanyActivity` in kody2) | `/api/kody/activity/autonomous` (Auto tab) |
| **Per-session events**  | `.kody/events/<sessionId>.jsonl`                           | default branch ⚠️    | the **engine** (chat/run event stream)            | `/api/kody/activity/feed` (Feed tab)       |
| **Workflow runs**       | GitHub Actions run history                                 | _(GitHub API)_       | GitHub (kody.yml dispatches)                      | `/api/kody/activity` (Runs tab)            |

> ⚠️ **Branch mismatch — flagged.** Company activity is read from the
> `kody-state` branch (correct — that's where the engine commits state), but
> the **Feed** source still reads `.kody/events/*.jsonl` from
> `process.env.KODY_STORE_BRANCH ?? "main"`, i.e. the default branch, not
> `kody-state`. See
> [`../src/dashboard/lib/activity/feed-source.ts`](../src/dashboard/lib/activity/feed-source.ts)
> (`const BRANCH = …`). If the engine stops writing event files to the default
> branch (or that repo's default isn't `main`), the Feed tab silently goes
> empty while Auto keeps working. This is a known seam between the two
> engine-authored sources reading different branches.

## The Log tab — dashboard actions

The **only source the dashboard itself writes.** Every meaningful dashboard
mutation calls `recordAudit(req, spec)`. It is **fire-and-forget** — it runs
inside Next's `after()` so the user's action returns immediately and is never
blocked or failed by audit logging, and it never throws.

Three things happen per record:

1. **Verified actor.** It resolves the acting GitHub login from the request's
   PAT (`resolveActorFromToken`), **not** the client-claimed login — you can't
   spoof who did it.
2. **Hot tier.** A bounded in-memory ring (per serverless instance, 500
   entries) for instant reads on this instance — zero GitHub budget.
3. **Durable tier.** A CAS write into the body of the `kody:audit-log` manifest
   issue (a JSON ring capped at **150** recent events), attributed to the
   acting user's own PAT so it spends _their_ rate budget, not the shared
   polling token.

The Log tab's API (`/api/kody/activity/log`) merges both tiers — durable ring
for cross-instance history + redeploy survival, in-memory ring for the brief
window before the `after()` write lands — de-duped by id, newest-first. It
falls back to in-memory only when there's no repo context, so the tab never
hard-fails.

`recordAudit` is called from task actions, capability CRUD + runs, goals, vault
secrets, executables, agent, and chat-command writes (see the `AuditSpec` shape
for the `action` / `resource` / `capability` / `agent` / `outcome` fields).

> A legacy `recordAction({…})` shim (in `action-log.ts`) still writes the
> in-memory ring **only** — no verified actor, no durable persist. New call
> sites should use `recordAudit`; the shim survives for paths with no request
> in scope.

## The Auto tab — engine activity

The engine's **own** work product: each line in `.kody/activity/<date>.jsonl`
is one named, attributed action the engine performed — _which agent member ran
which capability, why (schedule / manual / event), and the result_ (completed /
failed, with an optional structured `outcomeKind` + `reason`). Written by kody2
(`appendCompanyActivity`), parsed by
[`company.ts`](../src/dashboard/lib/activity/company.ts).

It is explicitly **not derived from commits/PRs** — those carry no agent, capability,
or purpose, so they can't answer "who ran this and why." The Auto tab is empty
until a capability runs on an engine version that writes these records (the empty
state says so).

> **Stale doc-comment — flagged.** The route file's header summary
> (`activity/autonomous/route.ts`) still describes this as "the PRs it opens /
> merges / closes" backed by `fetchRecentPRs`. The actual implementation calls
> `fetchCompanyActivity()` and reads `.kody/activity/*.jsonl`. The behavior is
> the company-activity feed; only the comment is out of date.

## The Runs tab — engine health

Folds kody.yml workflow runs into a health snapshot:
queue depth, a 15-minute **flood detector** (tuned off a real 984-comment
trigger-loop incident), median run duration, and breakdowns by trigger /
category / `@kody` action. It reads the **same cached, ETag/304-backed
`fetchWorkflowRuns`** data the rest of the dashboard already polls, so it adds
**no extra GitHub budget** (CLAUDE.md rate-limit rules). Polls every 30s.

Two enrichments are joined client-side from the open-issue list (also cached):

- **`@kody` action** — `actionFromLabels` reads each matched issue's `kody:*`
  phase label and maps it to the exact command (`kody:fixing` → `fix`,
  `kody:fixing-ci` → `fix-ci`, `kody:reviewing-ui` → `ui-review`, …). The same
  `kody:*` labels drive task lane derivation in
  [`../src/dashboard/lib/tasks/derive-column.ts`](../src/dashboard/lib/tasks/derive-column.ts)
  — **editing or renaming a `kody:*` label changes both what Runs shows here
  and where the card lands on the board.**
- **Task deep-link** — `mapRunIssueNumbers` ties a run to its issue (exact
  title match or `#<number>` reference) so a run row links to its dashboard
  task page.

`categorizeRun` is the honest ceiling of what the run payload alone supports —
it buckets into `scheduled` / `dispatch` / `command` / `manual` / `other` but
**cannot** see the `@kody` subcommand (that's why the label join above exists).
`skipped`/`cancelled` runs are shown but excluded from the flood/queue signals
so a normal burst doesn't trip a false alarm.

## The Feed tab — session event stream

The deepest view: one row per chat/run **session** (not per raw event),
grouped from the engine's per-session event files `.kody/events/<sessionId>.jsonl`.
Each session derives its origin from the id prefix (`vibe-1587-…` → vibe,
`live-direct-…` → direct, `live-test-…` → test, `live-…` → live), a human
title (the agent's first task restatement, since user prompts aren't logged),
lifecycle times, run deep-link, and an expandable, copyable list of raw events.

Unlike the polled tabs, the Feed is **load-on-demand** (fetches only when the
tab is open, never polled) and reads through the shared 60s-cached,
in-flight-deduped, stale-fallback path
([`feed-source.ts`](../src/dashboard/lib/activity/feed-source.ts)), capped at
the **12 most-recent sessions** — so steady state is ~zero GitHub calls.

The fold ([`feed.ts`](../src/dashboard/lib/activity/feed.ts)) is pure and keeps
the untouched payload on every event, so a row can expand to the exact emit
time and raw record.

## Attribution — the missing glue

The four tabs deliberately do **not** join into one timeline, because the
attribution needed to do so honestly isn't fully there:

| Source | Who-triggered-it is…         | How reliable                                                                                          |
| ------ | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| Log    | the verified PAT login       | **Strong** — resolved from the token, not spoofable.                                                  |
| Auto   | the `agent` slug + `capability`    | **Strong for the engine actor**, but it's the agent that ran, not the human who scheduled the capability. |
| Runs   | guessed from `kody:*` labels | **Weak** — `null` whenever a run can't be matched to a labelled open issue.                           |
| Feed   | the first message's author   | **Weak** — user prompts often aren't logged, so initiator is frequently `null`.                       |

There is no shared correlation id across the three GitHub-stored sources. A
true "this human approved X, which dispatched run Y, which emitted events Z"
thread would need a stable cross-source key (the missing glue). Until then,
treat the page as **four adjacent lenses on the same repo**, not one unified
audit thread.

## Tabs → endpoints → sources

```
┌──────────────────────────── Activity page (read-only) ────────────────────────────┐
│                                                                                     │
│  Log tab          Auto tab           Runs tab              Feed tab                 │
│    │                 │                  │                     │                     │
│    ▼                 ▼                  ▼                     ▼                     │
│ /activity/log   /activity/autonomous  /activity        /activity/feed              │
│ (poll 30s)      (poll 30s)            (poll 30s)        (on-demand, no poll)        │
│    │                 │                  │                     │                     │
│    ▼                 ▼                  ▼                     ▼                     │
│ in-mem ring     fetchCompany       fetchWorkflowRuns    readFeedEntries            │
│   +             Activity()         + fetchIssues        (.kody/events/*.jsonl)      │
│ readAudit       (.kody/activity/    (cached/ETag)        on default branch ⚠️       │
│ Durable()        *.jsonl)              │                     │                     │
│ (kody:audit-log  on kody-state         │  join via            │                     │
│  issue body)        │                  │  actionFromLabels    │                     │
│    │                │                  │  (kody:* labels)     │                     │
└────┼────────────────┼──────────────────┼──────────────────────┼─────────────────────┘
     ▼                ▼                  ▼                      ▼
 verified human   engine agent+capability   engine health +      per-session
 actions          + outcome           @kody action         event stream
   (dashboard-written)  (engine-written)  (GitHub Actions)    (engine-written)
```

GitHub is the broker for all four. The dashboard writes only the Log source
(into an issue body); the other three are read off engine/GitHub artifacts.

## File reference

| File                                                                                                   | Purpose                                                                                 |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| [`../app/activity/page.tsx`](../app/activity/page.tsx)                                                 | Route entry — mounts `ActivityPage`.                                                    |
| [`../src/dashboard/lib/components/ActivityPage.tsx`](../src/dashboard/lib/components/ActivityPage.tsx) | The four-tab UI (Log / Auto / Runs / Feed) with filters + expandable rows.              |
| [`../app/api/kody/activity/route.ts`](../app/api/kody/activity/route.ts)                               | `GET /api/kody/activity` — Runs tab (workflow-run health + label join).                 |
| [`../app/api/kody/activity/log/route.ts`](../app/api/kody/activity/log/route.ts)                       | `GET /api/kody/activity/log` — Log tab (durable + in-memory merge).                     |
| [`../app/api/kody/activity/autonomous/route.ts`](../app/api/kody/activity/autonomous/route.ts)         | `GET /api/kody/activity/autonomous` — Auto tab (company activity).                      |
| [`../app/api/kody/activity/feed/route.ts`](../app/api/kody/activity/feed/route.ts)                     | `GET /api/kody/activity/feed` — Feed tab (per-session events, on-demand).               |
| [`../src/dashboard/lib/activity/audit.ts`](../src/dashboard/lib/activity/audit.ts)                     | `recordAudit` — the durable, verified-actor write path.                                 |
| [`../src/dashboard/lib/activity/action-log.ts`](../src/dashboard/lib/activity/action-log.ts)           | `AuditEvent` shape, the in-memory hot ring, and the legacy `recordAction` shim.         |
| [`../src/dashboard/lib/activity/audit-store.ts`](../src/dashboard/lib/activity/audit-store.ts)         | Durable CAS ring in the `kody:audit-log` manifest issue body (cap 150).                 |
| [`../src/dashboard/lib/activity/action.ts`](../src/dashboard/lib/activity/action.ts)                   | `actionFromLabels` / `mapRunActions` — `kody:*` label → `@kody` action; run→issue join. |
| [`../src/dashboard/lib/activity/categorize.ts`](../src/dashboard/lib/activity/categorize.ts)           | Coarse run category from trigger + title (the ceiling without a label join).            |
| [`../src/dashboard/lib/activity/snapshot.ts`](../src/dashboard/lib/activity/snapshot.ts)               | Pure fold of workflow runs → signals + flood/queue alert.                               |
| [`../src/dashboard/lib/activity/types.ts`](../src/dashboard/lib/activity/types.ts)                     | Run/signal/alert shapes + flood/queue thresholds.                                       |
| [`../src/dashboard/lib/activity/feed.ts`](../src/dashboard/lib/activity/feed.ts)                       | Pure fold of raw event lines → sessions.                                                |
| [`../src/dashboard/lib/activity/feed-source.ts`](../src/dashboard/lib/activity/feed-source.ts)         | Rate-limit-safe reader for `.kody/events/*.jsonl` (note the branch caveat).             |
| [`../src/dashboard/lib/activity/company.ts`](../src/dashboard/lib/activity/company.ts)                 | Shape + JSONL parser for engine-authored `.kody/activity/*.jsonl`.                      |
| [`../src/dashboard/lib/tasks/derive-column.ts`](../src/dashboard/lib/tasks/derive-column.ts)           | Consumes the same `kody:*` labels for board lanes — kept in lockstep with `action.ts`.  |

## FAQ

**Log vs Auto — what's the difference?**

Audience and author. **Log** = what a _human_ did through the dashboard
(approvals, edits, vault writes), written by the dashboard with a verified
actor. **Auto** = what the _engine_ did on its own (a agent member ran a capability),
written by the engine. They never overlap.

**Why isn't there one merged timeline?**

Because there's no shared correlation key across the three GitHub-stored
sources, and two of them (Runs, Feed) can only _guess_ at the trigger. A merged
thread would over-claim attribution it can't prove. See
[Attribution](#attribution-the-missing-glue).

**Does the Activity page ever change anything?**

No. It's strictly read-only — health, history, and event drill-down. The only
_write_ in this whole area is `recordAudit` logging an action that some _other_
endpoint already performed.

**Why is the Feed tab sometimes empty when Auto has data?**

Likely the [branch mismatch](#the-three-sources-and-where-each-lives): Feed
reads event files from the default branch (`KODY_STORE_BRANCH ?? "main"`) while
Auto reads from `kody-state`. If the engine isn't writing `.kody/events/*` to
the branch Feed reads, the tab shows nothing. Feed is also load-on-demand and
capped at the 12 newest sessions.

**I renamed a `kody:*` label — what breaks?**

The Runs tab stops showing the `@kody` action for affected runs (the label map
in `action.ts` no longer matches), and the task board lane derivation in
`derive-column.ts` drifts too — the two read the same labels and are meant to
move together.

**How far back does the Log go?**

The durable ring keeps the most recent **150** events (a deliberate first-cut
cap to stay under GitHub's issue-body limit; long-term retention is a noted
follow-up). The in-memory ring holds up to 500 per instance but is lost on
redeploy — the durable issue is the cross-instance source of truth.
