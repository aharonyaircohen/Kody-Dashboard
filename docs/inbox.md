# Inbox & approvals

The dashboard ships an **inbox** that turns the staff's recommendations into a
one-tap operator decision: a staff member (the CTO, QA, pr-health triage, …)
posts a recommendation comment on a task, the operator sees it in the inbox
with **Approve / Reject / Dismiss** controls, and only the operator's tap can
make anything happen. The load-bearing guard is that **the dashboard never
invents a command** — Approve posts the _verbatim_ `@kody …` line the staff
member itself wrote (or runs a dashboard-native action like squash-merge),
and any command naming a verb the engine can't run is dropped to read-only
rather than posted. Nothing auto-acts in Phase 1; every recommendation waits
on a human.

Two facts shape everything below:

- **A recommendation only reaches the inbox if it `@`-mentions an operator.**
  The inbox is fed by the same body-scrape that drives web-push — the webhook
  receiver pulls `@login` handles out of the comment body. No mention, no
  entry. The operator list is **`github.operators` in `kody.config.json`** (a
  company-set plural list managed on the Config page), _not_ a duty's
  `mentions:` frontmatter. An empty list = a silent, permanently-empty inbox,
  which the inbox surfaces as a warning banner.
- **`approve` / `reject` / `dismiss` are dashboard inbox gates, not engine
  verbs.** The engine has no executor for them; posting `@kody approve` makes
  the engine reply "I don't recognize approve." So the dashboard guards them
  out of the command path and treats them as the operator's own verdict.

## The pieces

| Piece                       | What it is                                                                                                                                                                                       | Where                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| **Operator list**           | `github.operators` in the consumer repo's `kody.config.json` — the logins recommendation duties `@`-mention. Company-set, explicit (no auto-fill). Empty = recommendations reach nobody.        | [config.ts](../src/dashboard/lib/engine/config.ts#L301)                                     |
| **Inbox feed** (server)     | Durable, bot-written hand-off buffer. The webhook scrapes `@login` mentions and appends one entry per mentioned login, byte-capped FIFO. One issue labelled `kody:inbox-feed`.                  | [feed.ts](../src/dashboard/lib/inbox/feed.ts), [feed-server.ts](../src/dashboard/lib/inbox/feed-server.ts) |
| **Inbox gist** (per user)   | Each user's private per-repo gist (`kody-inbox:<owner>/<repo>`). The client watcher pulls _its own_ slice of the feed down into here — the inbox the operator actually reads.                   | [types.ts](../src/dashboard/lib/inbox/types.ts), [useInboxWatcher.tsx](../src/dashboard/lib/inbox/useInboxWatcher.tsx) |
| **Recommendation detector** | Pure: decides whether an entry is a staff recommendation and extracts the emitting staff slug, task number, action verb, and the exact `@kody …` command to post on Approve.                    | [recommendation.ts](../src/dashboard/lib/cto/recommendation.ts)                             |
| **Decision route**          | `POST /api/kody/cto/decision`. The operator's Approve/Reject/Dismiss verdict. Approve dispatches dispatchable verbs (or squash-merges); all three record to the trust ledger.                   | [decision/route.ts](../app/api/kody/cto/decision/route.ts)                                  |
| **Trust ledger**            | `kody:cto-decisions` manifest issue. Tallies approvals/rejections per staff+action. Phase 2 reads it for "graduation" — stop asking once an action clears the threshold with zero rejections.  | [decisions.ts](../src/dashboard/lib/cto/decisions.ts)                                        |
| **Backpressure gate**       | Code-enforced cap of **10 pending** undecided recommendations per staff member, applied at the single feed-write point so a chatty staff member can't flood (or crowd out) the queue.          | [backpressure.ts](../src/dashboard/lib/cto/backpressure.ts)                                  |
| **Approve-gate route**      | `POST /api/kody/tasks/approve` — the human merge gate for a PR. Atomic approve-review → squash-merge → (only if merged) delete branch + close issue. Distinct from the recommendation verdict. | [tasks/approve/route.ts](../app/api/kody/tasks/approve/route.ts)                            |
| **Inbox UI**                | Two sections (Unread / Read); each recommendation row carries Approve/Reject/Dismiss + the literal command preview. Same controls in the thread dialog footer.                                 | [InboxList.tsx](../src/dashboard/lib/components/InboxList.tsx)                               |

## How a recommendation reaches the operator

```
┌────────────────────────┐  posts rec comment on a task
│ staff member (engine)   │  ➊ @<operator>  (mention = routing)
│ CTO / QA / pr-health    │  ➋ 🧭 marker + <!-- kody-staff: <slug> -->
└───────────┬─────────────┘  ➌ <!-- kody-cmd: @kody <verb> --pr N -->
            │ comment webhook
            ▼
┌─────────────────────────────────────────────┐
│ webhook receiver → dispatchMentionPushes      │
│  • extractMentions(body) → operator logins    │
│  • parse ctoAction / ctoCommand / ctoStaff    │
│    from the *raw* body (backticks intact)     │
│  • applyCtoBackpressure (≤10 pending / staff) │
│  • appendInboxFeed (bot token)                │
└───────────────────┬───────────────────────────┘
                    │ per-user client watcher, 60s poll
                    ▼
┌─────────────────────────────────────────────┐
│ user's private inbox gist (login's slice)    │
└───────────────────┬───────────────────────────┘
                    │ detectCtoRecommendation(entry)
                    ▼
┌─────────────────────────────────────────────┐
│ inbox UI — one row per rec:                  │
│   [Approve] [Reject] [Dismiss]   `@kody …`   │
└───────────────────┬───────────────────────────┘
                    │ operator taps a verdict
                    ▼
        POST /api/kody/cto/decision
```

The mention is the _only_ thing that routes a comment into the inbox — the
dashboard does not read a staff member's `mentions:` frontmatter, it reads the
literal `@login` in the posted body, and that login has to be in
`github.operators` for the engine to write it there in the first place. Three
machine-readable signals ride along in the raw body, parsed at feed-write time
while backticks are still intact (the 240-char snippet collapses them):

- `<!-- kody-staff: <slug> -->` — the emitting staff member, so the trust
  ledger and the backpressure cap are scoped per staff. Legacy recs without it
  default to `cto`.
- `<!-- kody-cmd: @kody … -->` — the **exact** command Approve will post.
- The prose marker (`🧭 **CTO recommendation** — \`<action>\``) — the action
  verb, and the legacy fallback for recs that predate the slug line.

All three HTML comments are stripped from the inbox snippet, so the operator
never sees the plumbing.

## The four verdicts

Three sit on every recommendation row in the inbox; the fourth is the separate
PR-merge gate.

### Approve

Approve runs the recommended action **before** recording, so a failed dispatch
never logs as a trusted approval. There are two execution shapes:

- **Dispatchable verb** (e.g. `execute`, `fix`, `fix-ci`, `sync`, `resolve`,
  `qa-review`) → the dashboard posts the staff member's own
  `<!-- kody-cmd: @kody … -->` line verbatim on the task (the engine's single
  write path). For `fix`, the QA-failure comment is already in-thread, so
  re-dispatching `@kody` _is_ the fix. The explicit `@kody fix --pr <n>` /
  `@kody sync --pr <n>` form, when present, comes from the staff member's
  `kody-cmd` line — the dashboard posts it as-is and never synthesizes it.
- **Dashboard-native action** (`merge`) → the dashboard squash-merges the PR
  itself via the GitHub API (the engine never auto-merges). A blocked merge
  (CI failing / conflict) returns **409 before recording**, so it never counts
  toward the trust streak.

If a verb is **non-dispatchable** (`comment`, or an unparseable `other`), there
is no dashboard executor: Approve only records the verdict and the row shows a
"Review on GitHub" link instead of an Approve button, so approving can never
silently post the wrong command.

### Reject

Records the rejection and **resets that action's consecutive-approval streak to
zero** — a single "no" blocks graduation and de-graduates an already-trusted
action back to "ask". This is the kill switch. No command is dispatched.

### Dismiss

A neutral verdict: it marks the recommendation _decided_ (so the backpressure
slot frees) **without** touching approvals/rejections/streak/mode. Use it to
drain stale recs the operator doesn't want to act on but doesn't want to
penalise the staff member over. Never dispatches a command, and can't be used
to game graduation by mass-dismissing.

### Approve-gate (PR merge)

A separate route — `POST /api/kody/tasks/approve` — is the **human merge gate**
for a finished PR (not a recommendation verdict). It is atomic: approve the PR
review → attempt a squash merge → **only if the merge actually succeeded**,
delete the work branch and close the linked issue. A merge blocked by CI or a
conflict returns 409 with a structured code and leaves the branch and issue
intact. (A past regression silently swallowed merge failures and ran
delete+close anyway, destroying work; that path is now closed and covered by an
e2e test.)

## Why `@kody approve` is never posted

`approve` / `reject` / `dismiss` are inbox gates the operator owns — the engine
has no executable for them. If a staff persona ever emits
`<!-- kody-cmd: @kody approve -->` (e.g. a QA duty trying to greenlight a PASS),
posting it verbatim makes the engine reply "I don't recognize approve." So the
command is guarded out at **three** layers:

1. `parseCtoCommand` rejects any `kody-cmd` line whose verb is in
   `NON_ENGINE_VERBS` at feed-write time, so a dead command is never stored.
2. `detectCtoRecommendation` re-checks stored commands and drops a dead one to
   the legacy verb→command fallback (or read-only) at render time.
3. The `/api/kody/cto/decision` route applies the same `isNonEngineCommand`
   guard server-side before posting, so even a hand-crafted client payload
   can't make the engine choke.

The right shape for a QA failure is `@kody fix --pr <pr> <concern>` (apply
feedback to the existing PR branch) or `@kody ui-review` for a re-verify —
never `@kody approve`.

## Recommendations land on issues, PRs, and discussions

An inbox entry's thread can be an **Issue** (the legacy task flow), a **Pull
Request** (PR-health recs: `fix-ci` / `sync` / `resolve` / `merge`), or a
**Discussion** (goals are GitHub Discussions). The detector resolves the task
number from `/issues/N` _or_ `/pull/N` URLs, and the backpressure key
additionally recognises `/discussions/N`. A goal mention in a Discussion routes
into the inbox as a normal entry, but `detectCtoRecommendation` only renders
Approve/Reject controls for issue/PR threads — a Discussion mention surfaces as
a plain mention, never misrouted as a dispatchable recommendation.

## Trust ledger & graduation (Phase 2)

Every verdict is tallied in the `kody:cto-decisions` manifest, nested by staff
slug → action verb (`approvals`, `rejections`, `consecutiveApprovals`, `mode`).
Phase 1 only _writes_ it. Phase 2 (graduation) has each staff member read its
own slice each tick and flip an action from `ask` → `auto` once
`consecutiveApprovals` clears `CTO_GRADUATION_THRESHOLD` (10) with zero
rejections. A single reject resets the streak and de-graduates the action back
to `ask`. Trust is per-staff: a chatty CTO graduating `execute` never grants QA
autonomy on its own `execute`.

The ledger doubles as the **verdict badge** source. `GET /api/kody/cto/decision`
returns the latest verdict per `staff:task:action`, and the inbox shows
"Approved / Rejected / Dismissed" instead of buttons for a rec already decided
on any device — gated by the entry's `sentAt` so a verdict recorded _before_ a
fresh re-post of the same `(task, action)` rec doesn't stamp the new one.

## File reference

| File                                                                                     | Purpose                                                            |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [recommendation.ts](../src/dashboard/lib/cto/recommendation.ts)                          | Pure detector — staff slug, task#, action verb, command to post   |
| [decisions.ts](../src/dashboard/lib/cto/decisions.ts)                                    | Trust-ledger types + `applyDecision` (graduation lives here)      |
| [decisions-server.ts](../src/dashboard/lib/cto/decisions-server.ts)                      | Server read/mutate over the `kody:cto-decisions` manifest issue   |
| [backpressure.ts](../src/dashboard/lib/cto/backpressure.ts)                              | Per-staff ≤10-pending cap, applied at the feed-write point        |
| [useCtoDecisions.ts](../src/dashboard/lib/cto/useCtoDecisions.ts)                        | Client query for the verdict badge (`sentAt`-gated)               |
| [inbox/feed.ts](../src/dashboard/lib/inbox/feed.ts)                                       | Feed manifest types, parse/serialize, byte-cap, CTO collapse key  |
| [inbox/feed-server.ts](../src/dashboard/lib/inbox/feed-server.ts)                         | CAS read/append over the `kody:inbox-feed` issue (bot token)      |
| [inbox/types.ts](../src/dashboard/lib/inbox/types.ts)                                     | Per-user gist manifest types + `buildSnippet`                     |
| [inbox/useInbox.ts](../src/dashboard/lib/inbox/useInbox.ts)                               | Client bindings — entries, mark-read, delete, append              |
| [inbox/useInboxWatcher.tsx](../src/dashboard/lib/inbox/useInboxWatcher.tsx)               | 60s poller syncing the feed slice into the user's gist            |
| [inbox/deep-link.ts](../src/dashboard/lib/inbox/deep-link.ts)                             | `?thread=<Type>:<n>` shareable inbox deep links                   |
| [notifications/channels/inbox.ts](../src/dashboard/lib/notifications/channels/inbox.ts)  | Inbox channel adapter — parses CTO signals, applies backpressure  |
| [push/mention-dispatch.ts](../src/dashboard/lib/push/mention-dispatch.ts)                | Webhook spine — mention scrape, recipient resolve, fan-out        |
| [operators/useOperators.ts](../src/dashboard/lib/operators/useOperators.ts)              | Client read/write of the `github.operators` list                  |
| [engine/config.ts](../src/dashboard/lib/engine/config.ts)                                | `readOperators` / `writeOperators` over `kody.config.json`        |
| [kody/squash-merge.ts](../src/dashboard/lib/kody/squash-merge.ts)                         | Shared squash-merge helper + failure taxonomy                     |
| [components/InboxList.tsx](../src/dashboard/lib/components/InboxList.tsx)                 | The inbox UI — rows, verdict controls, thread dialog footer       |
| [components/OperatorsCard.tsx](../src/dashboard/lib/components/OperatorsCard.tsx)         | Config-page card to manage the operator list                      |
| [components/OperatorsWarningBanner.tsx](../src/dashboard/lib/components/OperatorsWarningBanner.tsx) | Inbox banner when no operators are set                  |
| [app/api/kody/cto/decision/route.ts](../app/api/kody/cto/decision/route.ts)              | The Approve/Reject/Dismiss verdict route + verdict GET            |
| [app/api/kody/tasks/approve/route.ts](../app/api/kody/tasks/approve/route.ts)            | The human PR merge gate (atomic merge → cleanup)                  |

## FAQ

**My inbox is empty even though recommendations are being posted. Why?**

Almost certainly an empty operator list. A rec only routes into the inbox if it
`@`-mentions a login, and the login it mentions comes from `github.operators`
in `kody.config.json`. If that list is empty the staff member posts the comment
but mentions nobody, so the webhook scrapes no recipients and writes no feed
entry. Set yourself (or your team) as an operator on the **Config** page — the
inbox surfaces this exact case with a warning banner and a one-click "set me".

**Does Approve ever invent the command it posts?**

No. Approve posts the literal `<!-- kody-cmd: @kody … -->` line the staff
member wrote, verbatim. Legacy recs that predate that line fall back to a fixed
verb→command map. If neither resolves to a real engine command, the rec is
read-only (a "Review on GitHub" link) — the dashboard never guesses.

**Why isn't there an Approve button on this recommendation?**

Its action isn't dispatchable from the dashboard. `comment` and unparseable
`other` recs have no dashboard executor, and any rec whose command names a
non-engine verb (`approve` / `reject` / `dismiss`) is dropped to read-only on
purpose. You still get Reject/Dismiss plus a link to act on GitHub.

**What's the difference between "Approve" in the inbox and the PR approve-gate?**

They're different routes. The inbox **Approve** is a verdict on a _recommendation_
(`/api/kody/cto/decision`) — it dispatches the staff member's command or
squash-merges. The PR **approve-gate** (`/api/kody/tasks/approve`) is the human
merge gate for a finished PR: approve review → squash → delete branch → close
issue, atomically.

**Can a noisy staff member flood my inbox?**

No — there's a hard cap of 10 _pending_ (undecided) recommendations **per staff
member**, enforced in code at the single feed-write point. A rec over the cap
is withheld until the operator decides one and frees a slot. Plain mentions
(non-recommendations) are never gated.

**A `sync`/`fix-ci` rec keeps showing "Dismissed" even after a fresh post.**

That bug is fixed. Both the backpressure gate and the verdict badge compare the
decision's timestamp against the entry's `sentAt`, so a verdict recorded for an
_earlier_ rec on the same `(task, action)` pair no longer applies to a fresh
re-post.
