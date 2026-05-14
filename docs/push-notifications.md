# Push notifications

The dashboard ships as an installable PWA with browser/OS push notifications. When you @mention a user in any GitHub-backed thread (issues, PRs, comments, reviews, goal discussions), every device they've enabled push on gets a notification — independent of the rule-based Slack/Discord channels.

## Enabling on a device

Open the dashboard on the device and go to **Notifications → "Push notifications (this device)"**.

### iOS (iPhone / iPad)

Safari only allows push from installed PWAs. The flow:

1. Open the dashboard URL in **Safari** (not Chrome on iOS — it uses the same WebKit but the install path is Safari-only).
2. Tap the **Share** icon (square with up-arrow).
3. Scroll down and tap **Add to Home Screen**.
4. Open Kody from the new home screen icon.
5. Go to **Notifications → "Push notifications (this device)"** and tap **Enable**.
6. Accept the iOS permission prompt.

If you visit `/notifications` from Safari (not the installed PWA), the card shows a `needs-pwa` hint reminding you to install first.

### Android

Chrome (and Firefox, Edge) auto-prompt to install when you visit the dashboard. Tap **Install** (not "Create shortcut" — that's just a bookmark). Open Kody from the icon, then **Notifications → Enable**.

### Desktop (macOS/Windows/Linux)

Chrome/Edge: install via the ⊕ icon in the address bar, then enable from `/notifications`. Notifications appear in the OS notification center.

### Auto-enable on first PWA launch

The dashboard tries to subscribe automatically the first time it detects it's running as an installed PWA (`display-mode: standalone`). If iOS blocks the permission prompt due to no user gesture, you can tap **Enable** manually. Disabling sticks (a localStorage flag prevents re-prompting on every launch).

## Sending a test push

Once enabled, tap **Send test push** in the card. The server signs a one-shot push using the dashboard's VAPID keypair and sends it to your endpoint only. You should see a notification arrive with the current time — proves end-to-end delivery without going through the @mention path.

If the test arrives but `@mentions` don't: the GitHub webhook on your repo may need a refresh. POST `/api/webhooks/register` once to re-PATCH the event subscriptions on the existing hook (no new hook is created).

## What triggers a push

Currently: any `@username` matching a subscribed user's GitHub login, in the body of any of these GitHub events on the connected repo:

| Event | When |
|---|---|
| `issues` (opened, edited) | New issue body or edit |
| `pull_request` (opened, edited) | New PR body or edit |
| `issue_comment` (created) | Comment on an issue/PR |
| `pull_request_review_comment` (created) | Line comment on a PR diff |
| `pull_request_review` (submitted) | Review with a body |
| `commit_comment` (created) | Comment on a commit |
| `discussion` (created, edited) | New goal-discussion thread (dashboard goal chats are backed by GitHub Discussions) |
| `discussion_comment` (created) | Comment in a goal discussion |

The notification title is `@author mentioned you on "<thread title>"`. The body is the first ~180 characters of the comment/post, with code fences stripped, so repeated mentions on the same thread are distinguishable at a glance.

Self-mentions are intentionally allowed — if you `@yourself` it's almost always a deliberate self-cc/reminder.

## Architecture

```
                    GitHub event (issue, PR, discussion, ...)
                                  │
                                  ▼
                /api/webhooks/github/route.ts  (IP-verified, deduped)
                                  │
                                  ▼
            dispatchMentionPushes(eventType, payload)
                                  │
              ┌───────────────────┴───────────────────┐
              ▼                                       ▼
    extractMentions(body)                  readPushManifest()  ──┐
              │                                       │          │
              └──────────────► filter ◄───────────────┘          │
                              by login                           │
                                  │                              │
                                  ▼                              │
                webpush.sendNotification(sub, payload)           │
                                  │                              │
              ┌───────────────────┴───────────────────┐          │
              ▼                                       ▼          │
      ✓ 201 accepted                       ✗ 404/410 → prune ◄───┘
                                                  the manifest
```

Key files:

- **PWA shell**: [`public/manifest.json`](../public/manifest.json), [`public/sw.js`](../public/sw.js), [`public/icon.svg`](../public/icon.svg)
- **Service worker register**: [`src/dashboard/lib/push/ServiceWorkerRegister.tsx`](../src/dashboard/lib/push/ServiceWorkerRegister.tsx) (mounted in [`app/KodyProviders.tsx`](../app/KodyProviders.tsx))
- **Subscription manifest** (per repo, stored as a GitHub issue labelled `kody:push-subscriptions`):
  - Types/parser: [`src/dashboard/lib/push.ts`](../src/dashboard/lib/push.ts)
  - Server CAS mutator: [`src/dashboard/lib/push-server.ts`](../src/dashboard/lib/push-server.ts)
- **Channel adapter** (rule-based fan-out for the `web-push` channel type): [`src/dashboard/lib/notifications/channels/web-push.ts`](../src/dashboard/lib/notifications/channels/web-push.ts)
- **Mention dispatcher** (the per-user @mention fan-out used here): [`src/dashboard/lib/push/mention-dispatch.ts`](../src/dashboard/lib/push/mention-dispatch.ts)
- **API**:
  - `GET /api/push/public-key` — VAPID public for the browser's `pushManager.subscribe`
  - `POST/DELETE /api/push/subscribe` — register/remove a device, resolves `userLogin` from the PAT server-side
  - `POST /api/push/test` — one-shot push to just the calling device
- **UI**:
  - [`src/dashboard/lib/push/PushCard.tsx`](../src/dashboard/lib/push/PushCard.tsx) — the `/notifications` card
  - [`src/dashboard/lib/push/usePushSubscription.ts`](../src/dashboard/lib/push/usePushSubscription.ts) — `{ status, enable, disable, sendTest }` hook
  - [`src/dashboard/lib/push/useAutoEnablePush.ts`](../src/dashboard/lib/push/useAutoEnablePush.ts) — first-launch auto-subscribe in PWA mode

## VAPID keys

The dashboard uses Web Push (RFC 8030) with VAPID signing. The keypair is **derived deterministically from `KODY_MASTER_KEY`** via HKDF-SHA256 with the info string `kody-vapid:v1` — there is no separate `VAPID_*` env var to set. Every consumer that already has `KODY_MASTER_KEY` configured gets push for free.

Inspect the live keypair:

```bash
KODY_MASTER_KEY=<value> pnpm push:init
```

Rotate by bumping the info string to `kody-vapid:v2` in [`src/dashboard/lib/push/vapid-keys.ts`](../src/dashboard/lib/push/vapid-keys.ts) — every existing browser subscription becomes invalid and users have to re-enable on each device.

## Extending push to a new feature

Two paths, depending on where the new feature stores comments/mentions:

### Path 1 — Backed by GitHub (automatic)

If the new feature persists posts/comments as GitHub issues, PRs, comments, or discussions, push works **without any new code**. The existing webhook receiver routes the payload through `dispatchMentionPushes`.

**New GitHub event type not yet wired?** Add a `case` to `extractEvent` in [`mention-dispatch.ts`](../src/dashboard/lib/push/mention-dispatch.ts) with the right action filter (usually `created`/`opened`/`edited`) and pull `body` / `author` / `html_url` / `title` from the payload. Then POST `/api/webhooks/register` once to refresh the event subscription on the GitHub webhook hook (see [`webhooks/register.ts`](../src/dashboard/lib/webhooks/register.ts) for the canonical event list).

### Path 2 — Dashboard-native (manual)

If the new feature stores mentions only in dashboard state (no GitHub artifact), you have to call `dispatchMentionPushes` yourself from the write path:

```ts
import { dispatchMentionPushes } from "@dashboard/lib/push/mention-dispatch";

// inside the POST handler that persists the comment / post / message
await dispatchMentionPushes("issue_comment", {
  action: "created",
  repository: { full_name: `${owner}/${repo}`, owner: { login: owner }, name: repo },
  comment: { body, user: { login: authorLogin }, html_url: postUrl },
  issue: { title: threadTitle },
});
```

**Prefer routing through GitHub when feasible.** Every backed-by-GitHub feature gets push, Slack rules, audit history, and webhook delivery for free.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Card shows "Server keys missing" / 503 from `/api/push/public-key` | `KODY_MASTER_KEY` not set in Vercel env. |
| Card shows "Not supported" on iOS Safari | You're in Safari, not the installed PWA. Add to Home Screen first. |
| Card shows "Blocked" | OS-level permission denied. Unblock in **iOS Settings → Notifications → Kody** (or browser site-settings on desktop). |
| Test push works but @mentions don't | The webhook hook on your repo may not be subscribed to the relevant event. POST `/api/webhooks/register` to refresh. |
| Subscriptions silently fail with no log | Run `vercel logs https://<your-deployment>` and grep for `mention_push_*` — each silent-return path now logs its reason. |
| Got a mention notification but the body shows only the issue title (not the comment) | You're on a deploy from before the snippet-in-body fix. Redeploy. |
