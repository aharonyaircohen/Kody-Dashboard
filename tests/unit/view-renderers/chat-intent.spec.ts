/**
 * @testFramework vitest
 * @domain view-renderers
 */
import { describe, expect, it } from "vitest";
import type { ViewRendererDefinition } from "@dashboard/lib/view-renderers/renderers";
import {
  shouldAllowPreRenderToolCallsForTurn,
  shouldRequireViewOutputForAssistantText,
  shouldRequireViewOutputForTurn,
} from "@dashboard/lib/view-renderers/chat-intent";

describe("view renderer chat intent", () => {
  const choiceRenderer: ViewRendererDefinition = {
    slug: "choice",
    name: "Choice",
    purpose: "choice",
    rule: "Use when Kody asks the user to choose one item from a list.",
    data: {
      items: { type: "selection", description: "Choices." },
    },
    type: "layout",
    blocks: [{ type: "selection", bind: "items" }],
  };

  const okRenderer: ViewRendererDefinition = {
    slug: "decision",
    name: "Decision",
    purpose: "decision",
    rule: "Use when Kody asks the user to say OK before taking the next step.",
    data: {
      title: { type: "text", description: "Short title." },
    },
    type: "layout",
    blocks: [{ type: "title", bind: "title" }],
  };

  const approvalRenderer: ViewRendererDefinition = {
    slug: "decision-card",
    name: "Decision card",
    purpose: "decision",
    rule: "Use this purpose when Kody asks the user to approve, confirm, say OK, edit, cancel, or continue before taking the next step.",
    data: {
      title: {
        type: "text",
        description: "Short decision question or decision title.",
      },
      body: {
        type: "text",
        optional: true,
        description: "The action, plan, or context the user is reviewing.",
      },
      actions: {
        type: "actions",
        optional: true,
        description: "Available responses.",
      },
    },
    type: "layout",
    blocks: [
      { type: "title", bind: "title" },
      { type: "text", bind: "body" },
      { type: "buttons", bind: "actions" },
    ],
  };

  it("requires a rendered view when the user asks to select from listed records", () => {
    expect(
      shouldRequireViewOutputForTurn({
        userText: "list all reports allow me to select one",
        definitions: [choiceRenderer],
      }),
    ).toBe(true);
  });

  it("uses renderer definition text for non-list interactions too", () => {
    expect(
      shouldRequireViewOutputForTurn({
        userText: "ask the user a q which requires ok",
        definitions: [okRenderer],
      }),
    ).toBe(true);
  });

  it("requires a rendered view for approval confirmation wording", () => {
    expect(
      shouldRequireViewOutputForTurn({
        userText: "aske me a q and ask for approval to confirm it",
        definitions: [approvalRenderer],
      }),
    ).toBe(true);
  });

  it("allows plain output when no renderer definitions are available", () => {
    expect(
      shouldRequireViewOutputForTurn({
        userText: "list all reports allow me to select one",
        definitions: [],
      }),
    ).toBe(false);
  });

  it("allows plain output for ordinary report listing requests", () => {
    expect(
      shouldRequireViewOutputForTurn({
        userText: "list all reports",
        definitions: [choiceRenderer],
      }),
    ).toBe(false);
  });

  it("does not require a view when the request does not match the renderer", () => {
    expect(
      shouldRequireViewOutputForTurn({
        userText: "summarize all reports",
        definitions: [choiceRenderer],
      }),
    ).toBe(false);
  });

  it("allows read tools before rendering when the request names matching records", () => {
    expect(
      shouldAllowPreRenderToolCallsForTurn({
        userText: "list all reports allow me to select one",
        toolNames: ["list_reports", "read_report", "show_view"],
      }),
    ).toBe(true);
  });

  it("does not allow unrelated tools before pure approval rendering", () => {
    expect(
      shouldAllowPreRenderToolCallsForTurn({
        userText: "aske me a q and ask for approval to confirm it",
        toolNames: ["list_reports", "read_report", "show_view"],
      }),
    ).toBe(false);
  });

  it("requires a renderer when Kody's final answer asks the user to choose an action", () => {
    expect(
      shouldRequireViewOutputForAssistantText({
        assistantText:
          "Want me to file this as a bug issue in the repo so a dev can pick it up, or should I draft the small code change here?",
        definitions: [approvalRenderer],
      }),
    ).toBe(true);
  });

  it("allows plain final answers that are informational questions without a renderer interaction", () => {
    expect(
      shouldRequireViewOutputForAssistantText({
        assistantText:
          "The bug is in the login redirect. Does that make sense?",
        definitions: [approvalRenderer],
      }),
    ).toBe(false);
  });
});
