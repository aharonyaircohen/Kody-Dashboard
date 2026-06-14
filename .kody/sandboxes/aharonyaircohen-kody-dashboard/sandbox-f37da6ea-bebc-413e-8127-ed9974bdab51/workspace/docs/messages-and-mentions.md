# Messages & mentions

The dashboard ships a **team-chat surface** (`/messages`) — Slack-style
channels with a composer, @mention autocomplete, and per-channel unread
badges — plus the **mention dispatch** that turns any @mention in a
GitHub-backed thread into notifications. Both ride entirely on GitHub:
channels are Discussions, messages are discussion comments, and the
notification fan-out reuses the same webhook spine that powers
[push](./push-notifications.md), [Slack/Discord rules](./notifications.md),
and the dashboard inbox. No bespoke message store, no extra webhook.

## The two halves

| Half         | What it is                                                                                                     | Where                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Messages** | Team chat. Channels = `#`-titled GitHub Discussions; messages = discussion comments; gist-backed unread state. | [`MessagesView.tsx`](../src/dashboard/lib/components/MessagesView.tsx) |
| **Mentions** | The webhook → notification fan-out. One `@login` in any GitHub-backed body → inbox entry + push.               | [`mention-dispatch.ts`](../src/dashboard/lib/push/mention-dispatch.ts) |

They meet at the webhook: posting a message is a `discussion_comment`
event, which the receiver routes straight into mention dispatch — so a
channel @mention notifies teammates with **zero message-specific
notification code**.

## Messages

### Channels are Discussions

A channel is a GitHub Discussion in the repo's goals category whose title
starts with `#`. The list/create API
([`messages/route.ts`](../app/api/kody/messages/route.ts)) calls
`fetchMessageChannels` (cached) and, when Discussions are off or no
category exists, returns `{ enabled: false, reason, channels: [] }` so the
UI renders a disabled badge instead of an empty list.

A channel's message feed reuses the **goal-discussion comment** plumbing
([`messages/[number]/route.ts`](../app/api/kody/messages/[number]/route.ts)):
`fetchGoalDiscussionComments` to read, `postGoalDiscussionComment` to post.
Posting therefore invalidates the right per-discussion comment cache and —
because the comment is a real GitHub `discussion_comment` — fans @mentions
out to push / Slack / inbox for free. `DELETE` removes the whole channel
(and its messages).

### Composer

The composer ([`MessagesView.tsx`](../src/dashboard/lib/components/MessagesView.tsx))
is a markdown textarea with `@mention` autocomplete drawn from the shared
[`useMentionRoster`](../src/dashboard/lib/hooks/useMentionRoster.ts)
(collaborators + staff + self). Two mention kinds, distinguished by the
`staff` badge in the dropdown:

- **`@login`** (a person) → notifies that GitHub user (see [Mentions](#mentions)).
- **`@slug`** (a staff persona, e.g. `@cto`) → dispatches a one-shot
  `worker-ask` tick whose reply lands back in this thread. The composer
  does nothing special for staff; the message is posted as a normal
  discussion comment and the **webhook** detects the staff slug
  server-side. See [Staff mentions](#staff-mentions).

Typing the full username always notifies even if it isn't in the roster
dropdown — the dropdown is a convenience, not a gate.

### Unread badges (per-user, gist-backed)

The "new activity" dot on the Messages nav and per-channel rows is driven
by a **per-user, per-repo read-state gist** — the same private-gist model
the inbox uses, never a shared repo artifact:

- Manifest shape + parse/serialize:
  [`channels-seen.ts`](../src/dashboard/lib/messages/channels-seen.ts) —
  `{ version, baseline, seen }`, discovered by gist description
  `kody-channels:<owner>/<repo>`, one `channels-seen.json` file.
- Server CRUD (per-`(login, repo)` in-process mutex, lazy-create on first
  read): [`channels-seen-store.ts`](../src/dashboard/lib/messages/channels-seen-store.ts).
- API: [`messages/read-state/route.ts`](../app/api/kody/messages/read-state/route.ts) —
  `GET` returns `{ baseline, seen }`; `POST { channelNumber }` stamps that
  channel seen at `now`. Requires the PAT's `gist` scope (surfaces a
  `gist_scope_missing` 400 hint otherwise, mirroring `/api/kody/inbox`).
- Client: [`useChannelsUnread.ts`](../src/dashboard/lib/hooks/useChannelsUnread.ts) —
  a channel is unread when its `updatedAt` is newer than `seen[n]`, or, if
  never opened, newer than the store `baseline`.

**Baseline = "nothing before this counts as unread."** It's stamped `now`
when the gist is first created, so the very first time someone opens
Messages the whole pre-existing history doesn't flash as unread. A channel
with no `seen[n]` and an `updatedAt` predating the baseline reads as
already-seen.

### mark-seen (and the loop that used to happen)

Opening a channel marks it seen: `MessagesView` runs an effect on the
selected channel that calls `markSeen(n)`, which POSTs `read-state` and,
on success, writes the fresh manifest back into the query cache via
`setQueryData`.

That `setQueryData` is exactly what made the **endless-POST loop**
(fixed in commit `c184ea2`). The bug had two compounding causes, both now
guarded:

1. **`markSeen` changed identity every render.** The hook returned a
   callback that depended on the whole `useMutation` object — a new
   reference each render — so the effect's dependency array changed every
   render and re-ran. Each POST's `setQueryData` re-rendered, which
   produced a new `markSeen`, which re-fired the effect: an infinite POST
   loop. Fix: depend on the **stable `mutateAsync`** and wrap it in
   `useCallback([markSeenAsync])`.
2. **The effect had no "already marked this channel" guard.** Even with a
   stable callback, a re-render could re-POST. Fix: a `lastMarkedRef`
   ref — the effect bails when `lastMarkedRef.current === selected`, so it
   fires **once per channel selection**, never per render.

The net behavior now: select a channel → exactly one `read-state` POST →
the badge clears on this and every other device (it's the synced gist),
and switching back to an already-opened channel in the same session POSTs
nothing.

## Mentions

`dispatchMentionPushes` ([`mention-dispatch.ts`](../src/dashboard/lib/push/mention-dispatch.ts))
is the orchestrator. The webhook receiver
([`webhooks/github/route.ts`](../app/api/webhooks/github/route.ts)) calls
it (awaited — fire-and-forget would be killed before the manifest write
finishes on Vercel serverless) for every delivery. It owns the **flow**
only; the heavy lifting lives in dedicated modules:

```
       GitHub event (issue / PR / comment / review / discussion)
                              │
                              ▼
        /api/webhooks/github/route.ts   (IP-verified, deduped)
                              │
                              ▼
            dispatchMentionPushes(eventType, payload)
                              │
   ┌──────────────────────────┼───────────────────────────────┐
   ▼                          ▼                                ▼
 extractEvent          classify + per-type mute        resolveRecipients
 (buildSourceEvent     (mute prefs per recipient)      (mention scrape OR
  + action gate +                                       channel broadcast)
  bookkeeping skip)                                            │
                              ┌───────────────────────────────┤
                              ▼                                ▼
                     deliverInbox(ev, recipients)   deliverMentionPush(...)
                     (durable inbox feed)           (per-device web push)
```

Each stage is its own module:

- **Normalize** — `extractEvent` calls the shared
  [`buildSourceEvent`](../src/dashboard/lib/notifications/source-event.ts)
  (the single webhook parser, also used by the Slack-rules and staff
  spines), then applies the mention spine's own action gate (a comment
  must be `created`, a review `submitted`, an issue/PR/discussion
  `opened`/`edited`) and a "must have a body" rule.
- **Recipients** —
  [`resolveRecipients`](../src/dashboard/lib/notifications/recipients.ts)
  decides who: humans `@mentioned` in the body (default), or every channel
  subscriber except the author for a `#`-titled discussion (broadcast).
- **Per-type mute** — `classifyNotificationType` + each recipient's muted
  types ([`prefs-store.ts`](../src/dashboard/lib/notifications/prefs-store.ts))
  drop anyone who silenced that notification kind.
- **Deliver** — the durable inbox feed (`deliverInbox`) plus best-effort
  per-device web push (`deliverMentionPush`). Channel broadcasts skip the
  inbox (the recipient already has the message in-app + via broadcast push).

It **never throws** — it logs and swallows so a misconfigured push setup
can't break GitHub delivery.

### What triggers a mention

The trigger matrix (event types, actions, the `@author mentioned you on
"<title>"` push body) is documented once in
[push-notifications.md → What triggers a push](./push-notifications.md#what-triggers-a-push)
— it's the same `extractEvent` gate. The short version: any `@login` in
the body of a freshly-`created` comment/review or an `opened`/`edited`
issue / PR / discussion on the connected repo. Channel messages
additionally **broadcast** to every channel subscriber.

### No bot-AUTHOR filter (and why that's deliberate)

`dispatchMentionPushes` does **not** drop events by author. A comment
authored by the Kody App / bot still notifies whoever it `@mentions` —
which is what makes the manual **"Send task to staff"** / `worker-ask`
path land in the operator's inbox: that dispatch posts a bot-authored
comment that `@operator`, and because there's no author filter, the
mention is delivered. (See the memory note "Manual send task to staff =
existing worker-ask path".)

Two filters exist, and they are **not** an author filter — don't confuse
them:

1. **Bot command handles as recipients.** `extractMentions`
   ([`recipients.ts`](../src/dashboard/lib/notifications/recipients.ts))
   drops `@kody` / `@kodyade` from the _recipient_ set — they're the
   engine's command handle (`@kody sync --pr 12`), not a person. This is
   a recipient drop, not an author drop.
2. **Bookkeeping manifest issues.** `BOOKKEEPING_THREAD_TITLES` skips the
   dashboard's own scratchpad issues (inbox feed, push-subscription list,
   CTO decision ledger, control issue) — every dashboard write edits them
   and re-fires a webhook whose body is full of `@login` feed entries.
   Routing those would ping users with raw manifest text.

The staff `worker-ask` reply path _does_ guard against loops, but
separately and in a different module — see below.

### Staff mentions

`@slug` where `slug` is a known staff persona is handled by
[`staff-mention-dispatch.ts`](../src/dashboard/lib/push/staff-mention-dispatch.ts),
a sibling the webhook calls right after `dispatchMentionPushes`. It:

1. Normalizes via the same `buildSourceEvent` + an action gate.
2. Resolves the repo's staff roster (`.kody/staff/`) and matches slugs
   with [`extractStaffMentions`](../src/dashboard/lib/mentions/staff-mentions.ts)
   (staff slug wins over a colliding GitHub login).
3. Dispatches a one-shot `worker-ask` tick per matched slug, with the
   reply targeted back at the originating thread.

It has its **own** loop guard (distinct from the mention spine): it skips
bot/app authors (`authorIsBot`) and any body still carrying the
`@kody worker-ask` directive, so a staff reply can't re-trigger a run.

## Extending mentions to a new feature

This is documented end-to-end in
[push-notifications.md → Extending push to a new feature](./push-notifications.md#extending-push-to-a-new-feature).
Summary:

- **Backed by GitHub** (issues, PRs, comments, reviews, discussions) →
  **automatic.** The webhook already routes the payload through
  `dispatchMentionPushes`. A new GitHub _event type_ needs a `case` in
  `buildSourceEvent` + the mention spine's action gate, and the repo's
  webhook hook may need its event list refreshed (POST
  `/api/webhooks/register` — see [webhooks.md](./webhooks.md)).
- **Dashboard-native** (mention stored only in dashboard state, no GitHub
  artifact) → **manual.** Import `dispatchMentionPushes` and call it from
  the write path with a synthetic payload. Prefer routing through GitHub —
  every backed-by-GitHub feature gets push, Slack, inbox, and audit
  history for free.

Messages chose the GitHub-backed path (channels are Discussions), which is
why it needed no new dispatch code at all.

## File reference

| File                                                                               | Purpose                                                  |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [`MessagesView.tsx`](../src/dashboard/lib/components/MessagesView.tsx)             | Channel rail + thread + composer; mark-seen effect       |
| [`messages/route.ts`](../app/api/kody/messages/route.ts)                           | List / create channels (Discussions in goals category)   |
| [`messages/[number]/route.ts`](../app/api/kody/messages/[number]/route.ts)         | Channel feed: GET comments, POST message, DELETE channel |
| [`messages/read-state/route.ts`](../app/api/kody/messages/read-state/route.ts)     | Per-user unread state (GET / POST mark-seen)             |
| [`channels-seen.ts`](../src/dashboard/lib/messages/channels-seen.ts)               | Read-state manifest types + parse/serialize              |
| [`channels-seen-store.ts`](../src/dashboard/lib/messages/channels-seen-store.ts)   | Gist CRUD for read-state (lazy-create, mutex)            |
| [`useChannelsUnread.ts`](../src/dashboard/lib/hooks/useChannelsUnread.ts)          | Derives unread set; `markSeen` (loop-safe)               |
| [`mention-dispatch.ts`](../src/dashboard/lib/push/mention-dispatch.ts)             | `dispatchMentionPushes` orchestrator                     |
| [`source-event.ts`](../src/dashboard/lib/notifications/source-event.ts)            | Shared webhook → `SourceEvent` normalizer                |
| [`recipients.ts`](../src/dashboard/lib/notifications/recipients.ts)                | `extractMentions` + `resolveRecipients`                  |
| [`staff-mention-dispatch.ts`](../src/dashboard/lib/push/staff-mention-dispatch.ts) | `@slug` → one-shot `worker-ask` tick                     |
| [`staff-mentions.ts`](../src/dashboard/lib/mentions/staff-mentions.ts)             | Extract known staff slugs from a body                    |

## Related docs

- [push-notifications.md](./push-notifications.md) — device push internals, the trigger matrix, VAPID keys.
- [notifications.md](./notifications.md) — rule-based Slack / Telegram / Discord / generic-webhook channels.
- [webhooks.md](./webhooks.md) — the GitHub webhook receiver, IP verification, and event registration.
  </content>
  </invoke>
