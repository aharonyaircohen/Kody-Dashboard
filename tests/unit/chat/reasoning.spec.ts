/**
 * Unit tests for the chat reasoning parser. The parser guards the user-visible
 * assistant answer from scratchpad markers that can arrive in provider output
 * or live runner progress events.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, expect, it } from "vitest";
import {
  parseReasoning,
  stripReasoning,
} from "@dashboard/lib/chat/core/reasoning";

describe("parseReasoning", () => {
  it("splits a standard think block from the visible answer", () => {
    expect(parseReasoning("<think>private</think>\n\nFinal answer")).toEqual({
      reasoning: "private",
      answer: "\n\nFinal answer",
    });
  });

  it("treats an unclosed final think block as hidden streaming reasoning", () => {
    expect(parseReasoning("Visible answer\n<think>still private")).toEqual({
      reasoning: "still private",
      answer: "Visible answer\n",
    });
  });

  it("handles tag variants that models and gateways commonly emit", () => {
    expect(
      parseReasoning(
        '<thinking data-provider="x">private</thinking>\nFinal answer',
      ),
    ).toEqual({
      reasoning: "private",
      answer: "\nFinal answer",
    });
  });

  it("does not leak nested or already-tagged thinking chunks into the answer", () => {
    const parsed = parseReasoning(
      "<think><think>inner private</think></think>Final answer",
    );

    expect(parsed.reasoning).toBe("inner private");
    expect(parsed.answer).toBe("Final answer");
    expect(parsed.answer).not.toMatch(/<\/?think/i);
  });

  it("hides encoded scratchpad tags before markdown can render them as text", () => {
    expect(
      parseReasoning("&lt;think&gt;private&lt;/think&gt;Final answer"),
    ).toEqual({
      reasoning: "private",
      answer: "Final answer",
    });
  });

  it("removes a partial scratchpad tag suffix during streaming", () => {
    const parsed = parseReasoning("Final answer <thi");

    expect(parsed.answer).toBe("Final answer ");
    expect(parsed.answer).not.toContain("<thi");
  });
});

describe("stripReasoning", () => {
  it("returns only the trimmed visible answer", () => {
    expect(stripReasoning("<think>private</think>\n\nFinal answer")).toBe(
      "Final answer",
    );
  });
});
