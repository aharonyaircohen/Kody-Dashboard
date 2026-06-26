# Notifications

The dashboard's `/notifications` page configures rules that fire messages to external channels (Slack, Telegram, Discord, generic HTTP endpoints) when GitHub events occur.

## How it works

- One **manifest issue** per repo (label `kody:notifications-manifest`) holds all rules in a fenced JSON block. Same pattern as goals.
- Mutations go through a per-repo mutex with verify-after-write CAS so concurrent edits can't silently overwrite each other.
- The webhook receiver at [`app/api/webhooks/github/route.ts`](../app/api/webhooks/github/route.ts) hands every payload to [`notifications-dispatch.ts`](../src/dashboard/lib/notifications-dispatch.ts), which loads matching rules fresh and invokes the channel adapter under [`notifications/channels/`](../src/dashboard/lib/notifications/channels/).
- Errors in dispatch are logged and swallowed — a failed Slack POST never causes GitHub to retry the webhook.

## Events

| Event ID           | Fires when                                                            |
| ------------------ | --------------------------------------------------------------------- |
| `deploy_pr_merged` | A kody-managed deploy PR (`deploy: <a> → <b> (vX.Y.Z)`) is merged     |
| `release_failed`   | _(declared, not yet wired)_ A kody release flow ends `release-failed` |
| `task_completed`   | _(declared, not yet wired)_ A kody task PR is approved + merged       |
| `task_failed`      | _(declared, not yet wired)_ A kody task ends with errors              |
| `ci_failed`        | _(declared, not yet wired)_ A PR's CI fails                           |

Adding a new event source: add the case in [`notifications-dispatch.ts`](../src/dashboard/lib/notifications-dispatch.ts) and a corresponding entry in `NOTIFICATION_EVENTS` in [`notifications.ts`](../src/dashboard/lib/notifications.ts).

## Template variables

Available in any rule's `template` and in generic-webhook `jsonTemplate`:

| Token         | Source                                                               |
| ------------- | -------------------------------------------------------------------- |
| `{{repo}}`    | `<owner>/<name>` from the webhook payload                            |
| `{{prUrl}}`   | `pull_request.html_url`                                              |
| `{{prTitle}}` | `pull_request.title`                                                 |
| `{{prBody}}`  | `pull_request.body` (the full PR description)                        |
| `{{author}}`  | `pull_request.user.login`                                            |
| `{{version}}` | The `vX.Y.Z` parsed from the deploy PR title (deploy_pr_merged only) |

Unknown tokens stay as-is (`{{foo}}` → `{{foo}}`) so a typo doesn't blank the message.

## Channels

### Slack (incoming webhook)

1. https://api.slack.com/apps → your app (or **Create New App** → **From scratch**).
2. **Incoming Webhooks** → toggle on → **Add New Webhook to Workspace** → pick a channel → **Allow**.
3. Copy the URL (`https://hooks.slack.com/services/T.../B.../...`).
4. New rule → Channel = **Slack** → paste URL → **Test**.

### Telegram (bot API)

1. Talk to [@BotFather](https://t.me/botfather) → `/newbot` → follow prompts.
2. Save the bot token (format `123456:AA-Ee-...`).
3. Add the bot to your channel/group, give it permission to post.
4. Get the chat ID:
   - For a public channel: `@channelname`
   - For a group: forward a message from the group to [@userinfobot](https://t.me/userinfobot) — it returns the numeric chat ID (negative for groups).
5. New rule → Channel = **Telegram** → paste bot token + chat ID → **Test**.

### Discord (webhook)

1. Server settings → **Integrations** → **Webhooks** → **New Webhook** → pick channel → **Copy Webhook URL**.
2. New rule → Channel = **Discord** → paste URL → **Test**.

Discord caps message content at 2000 chars; the adapter truncates with an ellipsis.

### Generic webhook (custom HTTP POST)

For anything else: Mattermost, Google Chat, custom internal services, Twilio (WhatsApp/SMS), Mailgun.

Fields:

- **URL** — `https://...` only (http rejected).
- **Body format** — `JSON` (default) or `Form-encoded`.
- **JSON body template** — text rendered with `{{var}}` substitution, must parse as JSON after rendering. When omitted (and format=JSON), the body is `{"text":"<rendered top-level template>"}`.
- **Headers** _(via API only currently)_ — extra request headers, e.g. `Authorization: Basic ...`.

#### When to use JSON vs Form-encoded

- **JSON** (`application/json`) — modern APIs: Slack-shaped, Mattermost, Google Chat, Sentry, PagerCapability, custom services.
- **Form-encoded** (`application/x-www-form-urlencoded`) — Twilio, Mailgun, most "old-school" REST APIs. Requires a flat JSON-object template; the dashboard URL-encodes each key=value pair before posting.

#### Recipe: Twilio WhatsApp

1. Sign up at [twilio.com](https://www.twilio.com), enable the WhatsApp sandbox or production sender.
2. Find your **Account SID** and **Auth Token** in the Twilio console.
3. Compute `Authorization: Basic base64(SID:TOKEN)`.
4. New rule → Channel = **Generic webhook** with:
   - **URL**: `https://api.twilio.com/2010-04-01/Accounts/<ACCOUNT_SID>/Messages.json`
   - **Body format**: **Form-encoded**
   - **Body template**:
     ```json
     {
       "From": "whatsapp:+14155238886",
       "To": "whatsapp:+15551234567",
       "Body": "{{repo}} {{version}} deployed — {{prUrl}}"
     }
     ```
   - **Headers** _(API)_: `{ "Authorization": "Basic <base64>" }`

Twilio's WhatsApp messages outside an active session window must use a pre-approved template — the body content above won't be delivered for fresh contacts unless it matches a registered template.

#### Recipe: Mattermost

1. Mattermost admin → **Integrations** → **Incoming Webhooks** → **Add Incoming Webhook** → pick a channel → save → copy URL.
2. New rule → Channel = **Generic webhook** with:
   - **URL**: the webhook URL
   - **Body format**: **JSON**
   - **Body template**: `{"text": "{{repo}} {{version}} deployed — {{prUrl}}"}`

#### Recipe: Google Chat

1. Chat → space settings → **Apps & integrations** → **Manage webhooks** → **Add webhook** → copy URL.
2. New rule → Channel = **Generic webhook** with:
   - **URL**: the webhook URL
   - **Body format**: **JSON**
   - **Body template**: `{"text": "{{repo}} {{version}} deployed: {{prUrl}}"}`

## Security

Channel credentials (Slack URLs, Telegram bot tokens, Discord URLs, custom webhook headers) are **stored in the manifest issue body**. That issue is in the connected GitHub repo:

- **Private repo** — only collaborators can read; reasonable for most teams.
- **Public repo** — anyone can read; do **not** use channel types whose URLs grant posting rights (everything we support today).

If you need stricter isolation, the alternative is to keep credentials in repo Actions variables (`vars.SLACK_WEBHOOK_URL_RELEASES`) and reference them by name in the manifest. Not implemented today; tracked as a v2 follow-up.

## Troubleshooting

**Test button works, real events don't fire.**
Check that the webhook receiver is registered on the connected repo — see CLAUDE.md → "GitHub webhooks". The `/api/webhooks/github` endpoint must be reachable from GitHub's hook IPs.

**Test button posts, then "send_failed" on real event.**
Likely a length issue (Slack > 40KB, Telegram > 4096, Discord > 2000) or a malformed template. Check the dashboard logs — `notification_send_failed` log entries include the channel type and the rejection detail from the receiving service.

**A rule disappeared from the list.**
Some other writer (manual issue edit, another dashboard instance) clobbered the manifest. The CAS retry should handle most cases; if you see this happen, check the manifest issue's edit history (`/issues/<n>/timeline` on GitHub).

**Multiple deploy PR notifications fired for one merge.**
Both the engine (`release-deploy/deploy.sh`) and the dashboard fire today. After verifying the dashboard path works, the engine notify block can be removed in kody2 to deduplicate.

## Adding a new channel type

1. Add a variant to `NotificationChannel` in [`notifications.ts`](../src/dashboard/lib/notifications.ts).
2. Update `sanitizeChannel` and `isChannel` to recognize the new type.
3. Add a Zod variant to the `channelSchema` `discriminatedUnion` in **all three** routes:
   - [`app/api/kody/notifications/route.ts`](../app/api/kody/notifications/route.ts)
   - [`app/api/kody/notifications/[id]/route.ts`](../app/api/kody/notifications/[id]/route.ts)
   - [`app/api/kody/notifications/test/route.ts`](../app/api/kody/notifications/test/route.ts)
4. Add `<type>.ts` under [`notifications/channels/`](../src/dashboard/lib/notifications/channels/) exporting `send` + `validate`. Wire it into `index.ts`.
5. Add a `case` in `ChannelFields` in [`NotificationsManager.tsx`](../src/dashboard/lib/components/NotificationsManager.tsx) for the form fields.
6. Add a `channelTypeLabel` and `blankChannel` entry.

Tests: there are no notification-specific tests yet (v1 cut). When adding meaningful logic, add a unit test in `tests/unit/`.
