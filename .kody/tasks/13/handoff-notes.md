## Issue #13 — Per-type notification preferences, server-side

Done. All quality gates pass (typecheck, 812 tests, format).

### What was built

1. **prefs-store.ts** — Reusable `.kody/` JSON file-store on `kody-state` branch. ETag/304 reads, CAS writes with one retry on 409 conflict. One file per login at `.kody/notifications/preferences/<login>.json`.

2. **notification-types.ts** — Maps `MentionEvent` + `eventType` + `action` → `ServerNotificationType | null`. Returns null for unknown or non-webhook event types (those can't be enforced server-side).

3. **recipients.ts** — `resolveRecipients()` now accepts `notificationType` and `mutedTypesByLogin`. Drops muted recipients in both channel-broadcast and mention code paths.

4. **mention-dispatch.ts** — After reading push manifest, classifies the event type and batch-reads prefs for all unique logins in parallel (same token). Passes mute map to `resolveRecipients()`. Enforces muting uniformly for both push fan-out and inbox feed write.

5. **API route** — `app/api/notifications/preferences/route.ts`. GET reads from kody-state, POST writes with validation. Auth via `requireKodyAuth` + JWT payload of `x-kody-token`. Token priority: user's PAT > vault token.

6. **NotificationPreferences.tsx** — Server prefs loaded on mount (authoritative), synced on every toggle change via fire-and-forget POST. localStorage acts as optimistic cache.

7. **PushToggle.tsx** — Shows explicit "On"/"Off" badge next to the Enable/Disable button.

### Key design decisions

- `ServerNotificationType` = only the webhook-backed types (task-assigned, task-completed, task-failed, pr-ready, pr-merged, chat-response, gate-waiting). Client-only types silently fall through without enforcement.
- Prefs read is on the webhook hot path but is O(unique_mentioned_logins) in parallel calls. Could be optimized to one aggregated read if rate-limit budget becomes tight.
- No new uncached GitHub reads: all reads use `If-None-Match`, writes use CAS with retry.

### Files

New: `prefs-store.ts`, `notification-types.ts`, `notification-prefs-store.spec.ts`, `notification-types.spec.ts`, `app/api/notifications/preferences/route.ts`

Modified: `recipients.ts`, `mention-dispatch.ts`, `NotificationPreferences.tsx`, `PushToggle.tsx`, `recipients.spec.ts`
