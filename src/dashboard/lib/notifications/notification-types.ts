/**
 * @fileType utility
 * @domain kody
 * @pattern notification-type-mapper
 * @ai-summary Maps a normalized `SourceEvent` to a `ServerNotificationType`
 *   the per-type mute prefs can key on.
 *
 *   The webhook spine (`mention-dispatch.ts`) only produces a subset of the
 *   client's `NotificationType` — those backed by GitHub webhooks. Types
 *   produced purely by client-side polling (`task-completed`, `task-failed`,
 *   `task-started`, `stage-change`, `retry-started`) are outside the webhook
 *   spine and cannot be enforced server-side in this PR.
 *
 *   The mapping is intentionally conservative: events that don't clearly map
 *   to a mute-able type return `null` and are delivered without type filtering.
 *   Reading from `SourceEvent` (not the mention spine's old `MentionEvent`)
 *   keeps this module dependency-free of the dispatcher — no circular import.
 */

import type { ServerNotificationType } from "./prefs-store";
import type { SourceEvent } from "./source-event";

/**
 * Map a normalized webhook event to a server-known notification type.
 * Returns `null` when the event has no mute-able type.
 *
 * | GitHub event / action                  | ServerNotificationType |
 * | --------------------------------------- | ---------------------- |
 * | issue_comment / created                 | chat-response          |
 * | pull_request_review_comment / created   | chat-response          |
 * | commit_comment / created                | chat-response          |
 * | discussion_comment / created            | chat-response          |
 * | pull_request_review / submitted         | chat-response          |
 * | discussion / opened|edited              | chat-response          |
 * | issues / opened                         | task-assigned          |
 * | pull_request / opened                   | pr-ready               |
 * | pull_request / closed (merged)          | pr-merged              |
 *
 * `gate-waiting` / `task-*` come from client-side polling and can't be
 * enforced server-side in this PR.
 */
export function classifyNotificationType(
  ev: SourceEvent,
): ServerNotificationType | null {
  const { eventType, action } = ev;

  // Comment / review events — all treated as chat-response.
  if (
    eventType === "issue_comment" ||
    eventType === "pull_request_review_comment" ||
    eventType === "commit_comment" ||
    eventType === "discussion_comment" ||
    eventType === "pull_request_review"
  ) {
    return "chat-response";
  }

  if (eventType === "issues") {
    return action === "opened" ? "task-assigned" : null;
  }

  if (eventType === "pull_request") {
    if (action === "opened") return "pr-ready";
    // `closed` + merged is `pr-merged`, but note the mention spine's action
    // gate rejects `closed`, so this branch is only reachable if a future
    // caller relaxes that gate. Harmless to keep correct.
    if (action === "closed") return ev.pr?.merged ? "pr-merged" : null;
    return null;
  }

  if (eventType === "discussion") {
    return action === "opened" || action === "edited" ? "chat-response" : null;
  }

  return null;
}
