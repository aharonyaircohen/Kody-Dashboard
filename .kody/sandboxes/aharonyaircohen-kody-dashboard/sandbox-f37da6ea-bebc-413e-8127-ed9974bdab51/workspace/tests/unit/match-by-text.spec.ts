/**
 * End-to-end matcher tests for the chat → preview_act → extension path,
 * exercised in node against the actual logic ported into the extension.
 *
 * The selector in the user's bug report was literally
 *   button:has-text("Start Learning")
 * which the browser rejects because `:has-text` is Playwright syntax. The
 * fix is two-stage: `parseTextSelector` extracts {tag:"button",text:"Start
 * Learning"}, then `matchByText` resolves it against the live DOM. Both
 * stages are pure functions in protocol.ts and mirrored line-for-line in
 * extension/src/content.js; testing them here proves the full resolution
 * works end-to-end against a candidate set shaped like what the preview
 * frame's DOM scanner produces.
 */
import { describe, it, expect } from "vitest";
import {
  parseTextSelector,
  matchByText,
  type TextSelectorCandidate,
} from "@dashboard/lib/picker/protocol";

const candidates: TextSelectorCandidate[] = [
  { tag: "button", textContent: "Start Learning" },
  { tag: "button", textContent: "Login" },
  { tag: "button", textContent: "Save and continue" },
  { tag: "button", textContent: "Save", ariaLabel: "Save" },
  { tag: "a", textContent: "Forgot password?" },
  { tag: "a", textContent: "Start Learning Now" },
  { tag: "input", value: "Submit" },
];

describe("preview_act selector resolution (parseTextSelector + matchByText)", () => {
  it("resolves the exact selector from the user's bug log", () => {
    // button:has-text("Start Learning") — the failing case in production.
    const parsed = parseTextSelector('button:has-text("Start Learning")');
    expect(parsed).toEqual({ tag: "button", text: "Start Learning" });
    const matched = matchByText(candidates, parsed!.text, parsed!.tag);
    expect(matched?.textContent).toBe("Start Learning");
  });

  it("does not confuse a similar-but-longer label (substring) with the exact match", () => {
    // Both "Save" and "Save and continue" exist. Exact wins.
    const out = matchByText(candidates, "Save", "button");
    expect(out?.textContent).toBe("Save");
  });

  it("falls back to substring when no exact match exists", () => {
    // No "Start" candidate exactly, but two contain it. First-found wins.
    const out = matchByText(candidates, "Start", "button");
    expect(out?.textContent).toBe("Start Learning");
  });

  it("respects tag filter — won't return an <a> when the model asked for button", () => {
    // The <a> "Start Learning Now" would substring-match without the filter.
    const out = matchByText(candidates, "Start Learning Now", "button");
    expect(out).toBeNull();
  });

  it("matches against input value (for <input type='submit'>)", () => {
    const out = matchByText(candidates, "Submit");
    expect(out?.tag).toBe("input");
  });

  it("is case- and whitespace-insensitive", () => {
    const out = matchByText(candidates, "  START   learning  ", "button");
    expect(out?.textContent).toBe("Start Learning");
  });

  it("text='X' parsing path also resolves end-to-end", () => {
    const parsed = parseTextSelector('text="Login"');
    expect(parsed).toEqual({ text: "Login" });
    const matched = matchByText(candidates, parsed!.text, parsed!.tag);
    expect(matched?.textContent).toBe("Login");
  });

  it("returns null for empty needle", () => {
    expect(matchByText(candidates, "")).toBeNull();
    expect(matchByText(candidates, "   ")).toBeNull();
  });
});
