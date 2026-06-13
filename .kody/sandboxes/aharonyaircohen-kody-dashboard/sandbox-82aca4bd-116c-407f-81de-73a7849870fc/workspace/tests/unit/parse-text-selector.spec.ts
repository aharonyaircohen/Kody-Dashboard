/**
 * Unit tests for parseTextSelector.
 *
 * Root bug this fixes: the model wrote `button:has-text("Start Learning")`
 * (Playwright syntax) into a preview_act selector. Browsers reject that in
 * querySelector → every sub-frame returned "not found" → the action failed.
 * The extension now falls back to a text-based match when raw CSS fails;
 * this helper is the parsed form of those text selectors.
 *
 * The extension content script ports the same regex/logic; if this spec's
 * expectations change, update extension/src/content.js:parseTextSelector
 * to match. The dashboard-side parser is the source of truth (tested here).
 */
import { describe, it, expect } from "vitest";
import { parseTextSelector } from "@dashboard/lib/picker/protocol";

describe("parseTextSelector", () => {
  it("recognises tag:has-text with double quotes — the bug-from-the-log shape", () => {
    expect(parseTextSelector('button:has-text("Start Learning")')).toEqual({
      tag: "button",
      text: "Start Learning",
    });
  });

  it("recognises tag:has-text with single quotes", () => {
    expect(parseTextSelector("a:has-text('Login')")).toEqual({
      tag: "a",
      text: "Login",
    });
  });

  it("recognises bare :has-text (no tag prefix)", () => {
    expect(parseTextSelector(':has-text("Save")')).toEqual({ text: "Save" });
  });

  it("recognises text= forms", () => {
    expect(parseTextSelector('text="Submit"')).toEqual({ text: "Submit" });
    expect(parseTextSelector("text='Submit'")).toEqual({ text: "Submit" });
    expect(parseTextSelector("text=Submit")).toEqual({ text: "Submit" });
  });

  it("returns null for raw CSS — those go through querySelector instead", () => {
    expect(parseTextSelector("#email")).toBeNull();
    expect(parseTextSelector('button[aria-label="Close"]')).toBeNull();
    expect(parseTextSelector("nav > a.active")).toBeNull();
    expect(parseTextSelector("")).toBeNull();
  });

  it("returns null for selectors with extra junk so we don't false-positive", () => {
    expect(parseTextSelector('button:has-text("X") + span')).toBeNull();
    expect(parseTextSelector("text=")).toBeNull();
  });

  it("recognises :text-matches — the second selector flavor from the bug log", () => {
    // From the user's log: `h3:text-matches("כיתה ט - בסיס")` (Hebrew)
    expect(parseTextSelector('h3:text-matches("כיתה ט - בסיס")')).toEqual({
      tag: "h3",
      text: "כיתה ט - בסיס",
    });
  });

  it("recognises :text and :text-is shorthand pseudos", () => {
    expect(parseTextSelector('div:text("Hello")')).toEqual({
      tag: "div",
      text: "Hello",
    });
    expect(parseTextSelector(':text-is("Exact")')).toEqual({
      text: "Exact",
    });
  });

  it("handles non-ASCII text in any pseudo (Hebrew, CJK, emoji)", () => {
    expect(parseTextSelector('button:has-text("שלום")')).toEqual({
      tag: "button",
      text: "שלום",
    });
    expect(parseTextSelector('a:text("登录")')).toEqual({
      tag: "a",
      text: "登录",
    });
    expect(parseTextSelector('button:has-text("🚀 Launch")')).toEqual({
      tag: "button",
      text: "🚀 Launch",
    });
  });
});
