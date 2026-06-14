/**
 * Unit tests for composeActTimeoutError — the dashboard's translation of a
 * "no frame replied" timeout into a user-actionable message. Load-bearing
 * because sub-frames now stay silent when their selector doesn't match
 * (the multi-frame "not found" race fix); a click/fill/scroll-to timeout
 * therefore means "no preview frame in the tab contains this selector",
 * which the model needs to hear as such to pick a better selector next
 * turn — not as a vague "timed out".
 */
import { describe, it, expect } from "vitest";
import { composeActTimeoutError } from "@dashboard/lib/picker/protocol";

describe("composeActTimeoutError", () => {
  it("returns a selector-specific error for click ops", () => {
    const out = composeActTimeoutError(
      { op: "click", selector: "#login" },
      3000,
    );
    expect(out).toBe("selector not found in any preview frame: #login");
  });

  it("returns a selector-specific error for fill ops", () => {
    const out = composeActTimeoutError(
      { op: "fill", selector: "input[name='email']", value: "a@b.com" },
      3000,
    );
    expect(out).toBe(
      "selector not found in any preview frame: input[name='email']",
    );
  });

  it("returns a selector error for scroll-to-element", () => {
    const out = composeActTimeoutError(
      { op: "scroll", selector: ".footer" },
      3000,
    );
    expect(out).toBe("selector not found in any preview frame: .footer");
  });

  it("returns a generic timeout for scroll-by-dy (no selector)", () => {
    const out = composeActTimeoutError({ op: "scroll", dy: 200 }, 3000);
    expect(out).toBe("timed out after 3000ms");
  });

  it("returns a generic timeout for navigate", () => {
    const out = composeActTimeoutError(
      { op: "navigate", url: "/dashboard" },
      3000,
    );
    expect(out).toBe("timed out after 3000ms");
  });

  it("returns a generic timeout for wait", () => {
    const out = composeActTimeoutError({ op: "wait", ms: 500 }, 1500);
    expect(out).toBe("timed out after 1500ms");
  });
});
