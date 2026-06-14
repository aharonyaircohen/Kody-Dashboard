/**
 * Unit tests for the tool-call XML stripper. The kody agents emit their
 * tool calls inline in the model text stream (e.g. `<kody_run_issue />` and
 * `<tool_call>…</tool_call>` JSON blocks). The structured call is captured
 * separately as a `ToolCall` and surfaced via `ThinkingPanel`, so the raw
 * markup leaking into the visible assistant bubble is just noise. The
 * stripper scrubs it before render.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, expect, it } from "vitest";
import {
  parseAssistantContent,
  stripToolCallMarkup,
} from "@dashboard/lib/chat/tool-call-strip";

describe("stripToolCallMarkup", () => {
  it("removes a complete tool_call JSON block", () => {
    const input =
      'Before\n<tool_call>\n{"name":"kody_run_issue","arguments":{"issueNumber":45}}\n</tool_call>\nAfter';
    const out = stripToolCallMarkup(input);
    expect(out).not.toContain("<tool_call>");
    expect(out).not.toContain("</tool_call>");
    expect(out).toContain("Before");
    expect(out).toContain("After");
  });

  it("removes an unclosed tool_call block during streaming", () => {
    // Stream interrupted before the closing tag — strip everything from
    // the opening `<tool_call` so the bubble doesn't blink on raw XML.
    const out = stripToolCallMarkup(
      'Mid-sentence<tool_call>\n{"name":"kody_run_issue"',
    );
    expect(out).not.toContain("<tool_call>");
    expect(out).toBe("Mid-sentence");
  });

  it("removes a self-closing tool tag with a known tool name", () => {
    const out = stripToolCallMarkup(
      "Created issue <kody_run_issue /> on the repo.",
    );
    expect(out).not.toContain("<kody_run_issue");
    expect(out).not.toContain("/>");
    expect(out).toContain("Created issue");
    expect(out).toContain("on the repo.");
  });

  it("removes a self-closing tool tag with attributes", () => {
    const out = stripToolCallMarkup(
      '<kody_run_issue issueNumber="45" notes="ship it" />',
    );
    expect(out).not.toContain("kody_run_issue");
  });

  it("removes multiple self-closing tool tags in one turn", () => {
    const out = stripToolCallMarkup(
      "Did <kody_run_issue /> and <report_bug /> in parallel.",
    );
    expect(out).not.toContain("<kody_run_issue");
    expect(out).not.toContain("<report_bug");
    expect(out).toContain("Did");
    expect(out).toContain("in parallel.");
  });

  it("removes a dangling partial self-closing tag during streaming", () => {
    // Model has typed `<kody_run_issu` and is still emitting.
    const out = stripToolCallMarkup("Issue created <kody_run_issu");
    expect(out).not.toContain("<kody_run_issu");
  });

  it("preserves plain text and bare URLs untouched", () => {
    const text = "See https://github.com/foo/bar/issues/1 for the bug.";
    expect(stripToolCallMarkup(text)).toBe(text);
  });

  it("does not touch unknown tags", () => {
    const text = 'Keep <custom_tag attr="val" /> intact.';
    expect(stripToolCallMarkup(text)).toBe(text);
  });

  it("does not touch inline backticks or HTML", () => {
    const text = "Use `<KodyChat>` to render the rail.";
    expect(stripToolCallMarkup(text)).toBe(text);
  });

  it("handles empty input", () => {
    expect(stripToolCallMarkup("")).toBe("");
  });

  it("collapses runs of blank lines left by removed blocks", () => {
    const input = "Before\n\n\n\n\n<tool_call>\n{}\n</tool_call>\n\n\n\nAfter";
    const out = stripToolCallMarkup(input);
    expect(out).not.toMatch(/\n{3,}/);
  });
});

describe("parseAssistantContent", () => {
  it("strips tool_call markup from the visible answer", () => {
    const { answer } = parseAssistantContent(
      'Done.\n<tool_call>\n{"name":"kody_run_issue"}\n</tool_call>',
    );
    expect(answer).not.toContain("<tool_call>");
    expect(answer).toContain("Done.");
  });

  it("preserves <think> reasoning separate from the answer", () => {
    const { reasoning, answer } = parseAssistantContent(
      "<think>private plan</think>\n\nFinal answer",
    );
    expect(reasoning).toBe("private plan");
    expect(answer).toBe("Final answer");
  });

  it("strips both reasoning and tool-call markup from the answer", () => {
    const { reasoning, answer } = parseAssistantContent(
      "<think>plan</think>\n\nDone <kody_run_issue />.",
    );
    expect(reasoning).toBe("plan");
    expect(answer).not.toContain("<think>");
    expect(answer).not.toContain("kody_run_issue");
    expect(answer).toBe("Done .");
  });

  it("removes leaked reasoning copied into the visible answer", () => {
    const leaked =
      "The user is asking whether thinking leaks. I need to inspect the render path.";
    const { reasoning, answer } = parseAssistantContent(
      `<think>${leaked}</think>\n\n${leaked}\n\nFinal answer: Yes, it can leak.`,
    );

    expect(reasoning).toBe(leaked);
    expect(answer).toBe("Yes, it can leak.");
  });

  it("removes an untagged reasoning preamble before a final answer", () => {
    const { answer } = parseAssistantContent(
      "Analysis: The user asked for verification. I should answer from the code.\n\nFinal answer: It is verified.",
    );

    expect(answer).toBe("It is verified.");
  });

  it("keeps normal assistant answers that start with first-person wording", () => {
    const { answer } = parseAssistantContent(
      "I need one detail before I can run this safely: which branch should I use?",
    );

    expect(answer).toBe(
      "I need one detail before I can run this safely: which branch should I use?",
    );
  });

  it("returns empty answer for empty input", () => {
    expect(parseAssistantContent("")).toEqual({ reasoning: "", answer: "" });
  });
});
