import { describe, expect, it } from "vitest";
import {
  FINAL_ANSWER_TOOL,
  SHOW_VIEW_TOOL,
  getToolErrorMessage,
  isToolErrorOutput,
  selectChatOutputActiveTools,
} from "@dashboard/lib/chat-output-tools";

describe("chat output tools", () => {
  it("classifies structured tool error outputs", () => {
    expect(isToolErrorOutput({ error: "show_view requires data" })).toBe(true);
    expect(getToolErrorMessage({ error: "show_view requires data" })).toBe(
      "show_view requires data",
    );
    expect(isToolErrorOutput({ error: "" })).toBe(false);
    expect(isToolErrorOutput({ content: "ok" })).toBe(false);
  });

  it("keeps renderer tools available for ordinary answer turns", () => {
    expect(
      selectChatOutputActiveTools({
        toolNames: [
          FINAL_ANSWER_TOOL,
          SHOW_VIEW_TOOL,
          "fetch_url",
          "list_reports",
        ],
        requireViewOutput: false,
        allowPreRenderTools: false,
        finalAnswerNeedsView: false,
      }),
    ).toEqual([FINAL_ANSWER_TOOL, SHOW_VIEW_TOOL, "fetch_url", "list_reports"]);
  });

  it("allows renderer output after an interactive final answer is rejected", () => {
    expect(
      selectChatOutputActiveTools({
        toolNames: [FINAL_ANSWER_TOOL, SHOW_VIEW_TOOL, "list_reports"],
        requireViewOutput: false,
        allowPreRenderTools: false,
        finalAnswerNeedsView: true,
      }),
    ).toEqual([SHOW_VIEW_TOOL]);
  });

  it("allows read tools before renderer output for explicit selection turns", () => {
    expect(
      selectChatOutputActiveTools({
        toolNames: [FINAL_ANSWER_TOOL, SHOW_VIEW_TOOL, "list_reports"],
        requireViewOutput: true,
        allowPreRenderTools: true,
        finalAnswerNeedsView: false,
      }),
    ).toEqual([SHOW_VIEW_TOOL, "list_reports"]);
  });
});
