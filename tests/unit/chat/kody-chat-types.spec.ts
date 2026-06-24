/**
 * Unit tests for KodyChat's UI⇄storage message converters and the
 * issue-creation tool-name set (extracted from KodyChat.tsx).
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, it, expect } from "vitest";
import {
  chatToMessage,
  messageToChat,
  ISSUE_CREATION_TOOL_NAMES,
  getCreatedIssueNumberFromToolOutput,
  type Message,
} from "@dashboard/lib/components/kody-chat-types";
import type { ChatMessage } from "@dashboard/lib/chat-types";

const toolCalls = [
  {
    id: "tu_1",
    name: "create_feature",
    arguments: { title: "x" },
    result: { number: 7 },
    status: "success" as const,
    durationMs: 120,
  },
];

describe("chatToMessage", () => {
  it("maps storage shape (text) onto UI shape (content)", () => {
    const chat: ChatMessage = {
      role: "assistant",
      text: "hello",
      timestamp: "2026-05-24T00:00:00.000Z",
      toolCalls,
      isLoading: false,
      attachments: [],
    };
    const msg = chatToMessage(chat);
    expect(msg.role).toBe("assistant");
    expect(msg.content).toBe("hello");
    expect(msg.timestamp).toBe("2026-05-24T00:00:00.000Z");
    expect(msg.toolCalls).toEqual(toolCalls);
    expect(msg.attachments).toEqual([]);
  });
});

describe("messageToChat", () => {
  it("maps UI shape (content) back onto storage shape (text)", () => {
    const msg: Message = {
      role: "user",
      content: "hi there",
      timestamp: "2026-05-24T01:02:03.000Z",
      toolCalls,
    };
    const chat = messageToChat(msg);
    expect(chat.role).toBe("user");
    expect(chat.text).toBe("hi there");
    expect(chat.timestamp).toBe("2026-05-24T01:02:03.000Z");
    expect(chat.toolCalls).toEqual(toolCalls);
  });

  it("defaults a missing timestamp to an ISO string", () => {
    const chat = messageToChat({ role: "user", content: "no ts" });
    expect(() => new Date(chat.timestamp).toISOString()).not.toThrow();
    expect(new Date(chat.timestamp).toISOString()).toBe(chat.timestamp);
  });
});

describe("round-trip", () => {
  it("chat → message → chat preserves the durable fields", () => {
    const original: ChatMessage = {
      role: "assistant",
      text: "round trip",
      timestamp: "2026-05-24T02:00:00.000Z",
      toolCalls,
      attachments: [],
    };
    const back = messageToChat(chatToMessage(original));
    expect(back.role).toBe(original.role);
    expect(back.text).toBe(original.text);
    expect(back.timestamp).toBe(original.timestamp);
    expect(back.toolCalls).toEqual(original.toolCalls);
  });
});

describe("ISSUE_CREATION_TOOL_NAMES", () => {
  it("contains exactly the seven issue-creation tools", () => {
    expect([...ISSUE_CREATION_TOOL_NAMES].sort()).toEqual(
      [
        "create_task",
        "create_chore",
        "create_documentation",
        "create_enhancement",
        "create_feature",
        "create_refactor",
        "report_bug",
      ].sort(),
    );
  });

  it("does not flag unrelated tool names", () => {
    expect(ISSUE_CREATION_TOOL_NAMES.has("kody_run_issue")).toBe(false);
    expect(ISSUE_CREATION_TOOL_NAMES.has("fetch_url")).toBe(false);
  });
});

describe("getCreatedIssueNumberFromToolOutput", () => {
  it("accepts only successful issue-creation tool outputs", () => {
    expect(
      getCreatedIssueNumberFromToolOutput("create_task", {
        number: 123,
        url: "https://github.com/acme/repo/issues/123",
      }),
    ).toBe(123);
    expect(
      getCreatedIssueNumberFromToolOutput("report_bug", { number: 9 }),
    ).toBe(9);
  });

  it("rejects read tools and failed create tools", () => {
    expect(
      getCreatedIssueNumberFromToolOutput("github_get_issue", {
        number: 123,
        url: "https://github.com/acme/repo/issues/123",
      }),
    ).toBeNull();
    expect(
      getCreatedIssueNumberFromToolOutput("create_task", {
        error: "GitHub rejected the request",
      }),
    ).toBeNull();
  });

  it("rejects invalid issue numbers", () => {
    expect(
      getCreatedIssueNumberFromToolOutput("create_task", { number: "123" }),
    ).toBeNull();
    expect(
      getCreatedIssueNumberFromToolOutput("create_task", { number: 0 }),
    ).toBeNull();
  });
});
