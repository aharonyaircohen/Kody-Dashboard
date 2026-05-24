/**
 * Unit tests for the notification type classifier
 * (src/dashboard/lib/notifications/notification-types.ts). Maps a
 * MentionEvent + eventType + action to a ServerNotificationType.
 */
import { describe, it, expect } from "vitest";
import { classifyNotificationType } from "@dashboard/lib/notifications/notification-types";
import type { MentionEvent } from "@dashboard/lib/push/mention-dispatch";

function ev(overrides: Partial<MentionEvent> = {}): MentionEvent {
  return {
    body: "test body",
    author: "tester",
    repoFullName: "acme/widgets",
    threadType: "Issue",
    ...overrides,
  };
}

describe("classifyNotificationType", () => {
  it("maps issue_comment:created → chat-response", () => {
    expect(
      classifyNotificationType(
        ev({ threadType: "Issue" }),
        "issue_comment",
        "created",
      ),
    ).toBe("chat-response");
  });

  it("maps pull_request_review_comment:created → chat-response", () => {
    expect(
      classifyNotificationType(
        ev({ threadType: "PullRequest" }),
        "pull_request_review_comment",
        "created",
      ),
    ).toBe("chat-response");
  });

  it("maps commit_comment:created → chat-response", () => {
    expect(
      classifyNotificationType(
        ev({ threadType: "Commit" }),
        "commit_comment",
        "created",
      ),
    ).toBe("chat-response");
  });

  it("maps discussion_comment:created → chat-response", () => {
    expect(
      classifyNotificationType(
        ev({ threadType: "Discussion" }),
        "discussion_comment",
        "created",
      ),
    ).toBe("chat-response");
  });

  it("maps pull_request_review:submitted → chat-response", () => {
    expect(
      classifyNotificationType(
        ev({ threadType: "PullRequest" }),
        "pull_request_review",
        "submitted",
      ),
    ).toBe("chat-response");
  });

  it("maps issues:opened → task-assigned", () => {
    expect(
      classifyNotificationType(ev({ threadType: "Issue" }), "issues", "opened"),
    ).toBe("task-assigned");
  });

  it("maps issues:edited → null (not a new assignment)", () => {
    expect(
      classifyNotificationType(ev({ threadType: "Issue" }), "issues", "edited"),
    ).toBe(null);
  });

  it("maps issues:closed → null (column transition is client-side)", () => {
    expect(
      classifyNotificationType(ev({ threadType: "Issue" }), "issues", "closed"),
    ).toBe(null);
  });

  it("maps pull_request:opened → pr-ready", () => {
    expect(
      classifyNotificationType(
        ev({ threadType: "PullRequest" }),
        "pull_request",
        "opened",
      ),
    ).toBe("pr-ready");
  });

  it("maps pull_request:closed (merged=true) → pr-merged", () => {
    const mergedEv = ev({ threadType: "PullRequest", pr: { merged: true } });
    expect(classifyNotificationType(mergedEv, "pull_request", "closed")).toBe(
      "pr-merged",
    );
  });

  it("maps pull_request:closed (merged=false) → null", () => {
    const unmergedEv = ev({ threadType: "PullRequest", pr: { merged: false } });
    expect(classifyNotificationType(unmergedEv, "pull_request", "closed")).toBe(
      null,
    );
  });

  it("maps discussion:opened → chat-response", () => {
    expect(
      classifyNotificationType(
        ev({ threadType: "Discussion" }),
        "discussion",
        "opened",
      ),
    ).toBe("chat-response");
  });

  it("maps discussion:edited → chat-response", () => {
    expect(
      classifyNotificationType(
        ev({ threadType: "Discussion" }),
        "discussion",
        "edited",
      ),
    ).toBe("chat-response");
  });

  it("maps unknown event types → null", () => {
    expect(classifyNotificationType(ev(), "unknown_event", "created")).toBe(
      null,
    );
  });
});
