/**
 * Unit tests for the chat page-context helpers
 * (src/dashboard/lib/chat/page-context.ts). These let the model answer "what
 * am I currently viewing?" by carrying the user's dashboard page into the
 * chat — as a user-turn prefix on the engine/brain backends (which have no
 * ambient-context slot).
 *
 * Load-bearing behavior: a missing/blank page is a no-op (existing behavior
 * unchanged), only the LATEST user turn is tagged (history stays clean), and
 * the transform is immutable (never mutates the caller's messages).
 */
import { describe, it, expect } from "vitest";
import {
  dashboardPageContextLine,
  withPageContext,
  applyPageContextToLastUser,
} from "@dashboard/lib/chat/core/page-context";

describe("dashboardPageContextLine", () => {
  it("returns null for missing or blank input", () => {
    expect(dashboardPageContextLine(null)).toBeNull();
    expect(dashboardPageContextLine(undefined)).toBeNull();
    expect(dashboardPageContextLine("   ")).toBeNull();
  });

  it("embeds the page phrase and the disambiguation hint", () => {
    const line = dashboardPageContextLine("the Variables page (/variables)");
    expect(line).toContain("the Variables page (/variables)");
    expect(line).toContain("this page");
  });
});

describe("withPageContext", () => {
  it("is a no-op when there's no page", () => {
    expect(withPageContext("hello", null)).toBe("hello");
    expect(withPageContext("hello", "")).toBe("hello");
  });

  it("prefixes the context line above the original content", () => {
    const out = withPageContext("hello", "the Secrets page (/secrets)");
    expect(out.endsWith("hello")).toBe(true);
    expect(out).toContain("the Secrets page (/secrets)");
    expect(out.indexOf("Secrets")).toBeLessThan(out.indexOf("hello"));
  });
});

describe("applyPageContextToLastUser", () => {
  const base = [
    { role: "user", content: "first" },
    { role: "assistant", content: "reply" },
    { role: "user", content: "second" },
  ] as const;

  it("returns a copy unchanged when there's no page", () => {
    const out = applyPageContextToLastUser(base, null);
    expect(out).toEqual(base);
    expect(out).not.toBe(base); // new array (immutable)
  });

  it("tags only the most recent user turn", () => {
    const out = applyPageContextToLastUser(base, "the Models page (/models)");
    expect(out[0]!.content).toBe("first"); // earlier user turn untouched
    expect(out[1]!.content).toBe("reply"); // assistant untouched
    expect(out[2]!.content).toContain("the Models page (/models)");
    expect(out[2]!.content.endsWith("second")).toBe(true);
  });

  it("does not mutate the input array or its objects", () => {
    const input = [{ role: "user", content: "hi" }];
    applyPageContextToLastUser(input, "the Inbox page (/inbox)");
    expect(input[0]!.content).toBe("hi");
  });

  it("is a no-op when there's no user turn to tag", () => {
    const onlyAssistant = [{ role: "assistant", content: "hi" }];
    const out = applyPageContextToLastUser(onlyAssistant, "the page at /x");
    expect(out).toEqual(onlyAssistant);
  });
});
