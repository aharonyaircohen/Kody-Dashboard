/**
 * Unit tests for the notification type classifier
 * (src/dashboard/lib/notifications/notification-types.ts). Maps a normalized
 * SourceEvent to a ServerNotificationType.
 */
import { describe, it, expect } from "vitest";
import { classifyNotificationType } from "@dashboard/lib/notifications/notification-types";
import type { SourceEvent } from "@dashboard/lib/notifications/source-event";

function ev(overrides: Partial<SourceEvent> = {}): SourceEvent {
  return {
    eventType: "issue_comment",
    action: "created",
    repoFullName: "acme/widgets",
    owner: "acme",
    repo: "widgets",
    body: "test body",
    author: "tester",
    authorIsBot: false,
    title: "",
    url: "https://gh/x",
    threadType: "Issue",
    ...overrides,
  };
}

describe("classifyNotificationType", () => {
  it("maps issue_comment:created → chat-response", () => {
    expect(
      classifyNotificationType(ev({ eventType: "issue_comment", action: "created" })),
    ).toBe("chat-response");
  });

  it("maps pull_request_review_comment:created → chat-response", () => {
    expect(
      classifyNotificationType(
        ev({ eventType: "pull_request_review_comment", action: "created" }),
      ),
    ).toBe("chat-response");
  });

  it("maps commit_comment:created → chat-response", () => {
    expect(
      classifyNotificationType(ev({ eventType: "commit_comment", action: "created" })),
    ).toBe("chat-response");
  });

  it("maps discussion_comment:created → chat-response", () => {
    expect(
      classifyNotificationType(
        ev({ eventType: "discussion_comment", action: "created" }),
      ),
    ).toBe("chat-response");
  });

  it("maps pull_request_review:submitted → chat-response", () => {
    expect(
      classifyNotificationType(
        ev({ eventType: "pull_request_review", action: "submitted" }),
      ),
    ).toBe("chat-response");
  });

  it("maps issues:opened → task-assigned", () => {
    expect(
      classifyNotificationType(ev({ eventType: "issues", action: "opened" })),
    ).toBe("task-assigned");
  });

  it("maps issues:edited → null (not a new assignment)", () => {
    expect(
      classifyNotificationType(ev({ eventType: "issues", action: "edited" })),
    ).toBe(null);
  });

  it("maps issues:closed → null (column transition is client-side)", () => {
    expect(
      classifyNotificationType(ev({ eventType: "issues", action: "closed" })),
    ).toBe(null);
  });

  it("maps pull_request:opened → pr-ready", () => {
    expect(
      classifyNotificationType(ev({ eventType: "pull_request", action: "opened" })),
    ).toBe("pr-ready");
  });

  it("maps pull_request:closed (merged=true) → pr-merged", () => {
    expect(
      classifyNotificationType(
        ev({
          eventType: "pull_request",
          action: "closed",
          threadType: "PullRequest",
          pr: { merged: true, title: "", body: "", url: "" },
        }),
      ),
    ).toBe("pr-merged");
  });

  it("maps pull_request:closed (merged=false) → null", () => {
    expect(
      classifyNotificationType(
        ev({
          eventType: "pull_request",
          action: "closed",
          threadType: "PullRequest",
          pr: { merged: false, title: "", body: "", url: "" },
        }),
      ),
    ).toBe(null);
  });

  it("maps discussion:opened → chat-response", () => {
    expect(
      classifyNotificationType(ev({ eventType: "discussion", action: "opened" })),
    ).toBe("chat-response");
  });

  it("maps discussion:edited → chat-response", () => {
    expect(
      classifyNotificationType(ev({ eventType: "discussion", action: "edited" })),
    ).toBe("chat-response");
  });

  it("maps unknown event types → null", () => {
    expect(
      classifyNotificationType(ev({ eventType: "unknown_event", action: "created" })),
    ).toBe(null);
  });
});
