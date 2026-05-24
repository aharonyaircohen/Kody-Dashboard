/**
 * @fileType utility
 * @domain kody
 * @pattern notification-type-mapper
 * @ai-summary Maps the shared `MentionEvent` (a classified webhook event from
 *   `mention-dispatch.ts`) to a `ServerNotificationType` the per-type mute
 *   prefs can key on.
 *
 *   The server's webhook spine (`mention-dispatch.ts`) only produces a subset
 *   of `NotificationType` — those backed by GitHub webhooks. Types produced
 *   purely by client-side polling (`task-completed`, `task-failed`,
 *   `task-started`, `stage-change`, `retry-started`) are outside the webhook
 *   spine and cannot be enforced server-side in this PR.
 *
 *   The mapping is intentionally conservative: events that don't clearly map
 *   to a mute-able type return `null` and are delivered without type filtering.
 *   Extending the map is a one-line addition.
 */

import type { ServerNotificationType } from "./prefs-store";
import type { MentionEvent } from "../push/mention-dispatch";

/**
 * Map a classified webhook event to a server-known notification type.
 * Returns `null` when the event has no mute-able type.
 *
 * Only these events are mapped (matching the `isMentionAction` gate in
 * `mention-dispatch.ts`):
 *
 * | GitHub event / action              | ServerNotificationType |
 * | ---------------------------------- | ---------------------- |
 * | issue_comment / created            | chat-response          |
 * | pull_request_review_comment / created | chat-response        |
 * | commit_comment / created           | chat-response          |
 * | discussion_comment / created       | chat-response          |
 * | pull_request_review / submitted    | chat-response          |
 * | issues / opened                   | task-assigned          |
 * | pull_request / opened             | pr-ready               |
 * | pull_request / closed (merged)    | pr-merged              |
 *
 * `gate-waiting` is produced by client-side polling and cannot be enforced
 * server-side in this PR.
 */
export function classifyNotificationType(
  ev: MentionEvent,
  eventType: string,
  action: string,
): ServerNotificationType | null {
  // Comment / review / discussion events — all treated as chat-response
  if (
    eventType === "issue_comment" ||
    eventType === "pull_request_review_comment" ||
    eventType === "commit_comment" ||
    eventType === "discussion_comment" ||
    eventType === "pull_request_review"
  ) {
    return "chat-response";
  }

  // Issue events
  if (eventType === "issues") {
    if (action === "opened") return "task-assigned";
    // "closed" with a body might be task-completed but we can't reliably tell —
    // the client-side polling is the authoritative source for column= done/failed.
    return null;
  }

  // PR events
  if (eventType === "pull_request") {
    if (action === "opened") return "pr-ready";
    if (action === "closed") {
      // Check merged flag — available on the MentionEvent via the pr object
      // (set by buildSourceEvent → extractEvent).
      const merged = ev.pr?.merged;
      if (merged === true) return "pr-merged";
      return null;
    }
    return null;
  }

  // Discussion events
  if (eventType === "discussion") {
    if (action === "opened" || action === "edited") return "chat-response";
    return null;
  }

  return null;
}
