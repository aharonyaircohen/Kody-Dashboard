/**
 * Unit tests for formatPickedElement (src/dashboard/lib/picker/protocol.ts) —
 * the pure function that turns a picked DOM element into the chat context
 * block. The cross-frame plumbing (extension + hook) needs a real browser, so
 * it's covered by manual/E2E; this locks the formatting contract.
 */
import { describe, it, expect } from "vitest";
import {
  formatPickedElement,
  type PickedElement,
} from "@dashboard/lib/picker/protocol";

function el(overrides: Partial<PickedElement> = {}): PickedElement {
  return {
    selector: "div > button:nth-of-type(2)",
    tagName: "button",
    id: null,
    classes: [],
    text: "",
    attributes: {},
    rect: { x: 0, y: 0, width: 10, height: 10 },
    url: "https://preview.example.com/",
    ...overrides,
  };
}

describe("formatPickedElement", () => {
  it("always opens with the header and includes tag, selector, and url", () => {
    const out = formatPickedElement(el());
    expect(out.startsWith("Selected element from the preview:")).toBe(true);
    expect(out).toContain("- Tag: `<button>`");
    expect(out).toContain("- Selector: `div > button:nth-of-type(2)`");
    expect(out).toContain("- URL: https://preview.example.com/");
  });

  it("renders id and classes inside the tag", () => {
    const out = formatPickedElement(
      el({ id: "submit", classes: ["btn", "btn-primary"] }),
    );
    expect(out).toContain("- Tag: `<button#submit.btn.btn-primary>`");
  });

  it("omits the text line when there is no text", () => {
    expect(formatPickedElement(el({ text: "" }))).not.toContain("- Text:");
  });

  it("includes the text line when present", () => {
    const out = formatPickedElement(el({ text: "Save changes" }));
    expect(out).toContain('- Text: "Save changes"');
  });

  it("filters class/id/style out of the attributes line", () => {
    const out = formatPickedElement(
      el({
        attributes: {
          class: "btn",
          id: "submit",
          style: "color: red",
          type: "submit",
          "data-testid": "save",
        },
      }),
    );
    expect(out).toContain('type="submit"');
    expect(out).toContain('data-testid="save"');
    expect(out).not.toContain("- Attributes: `class=");
    expect(out).not.toContain("style=");
  });

  it("omits the attributes line when only class/id/style are present", () => {
    const out = formatPickedElement(
      el({ attributes: { class: "btn", id: "x", style: "x" } }),
    );
    expect(out).not.toContain("- Attributes:");
  });

  it("caps the attributes line at 8 entries", () => {
    const attributes: Record<string, string> = {};
    for (let i = 0; i < 20; i++) attributes[`data-a${i}`] = String(i);
    const out = formatPickedElement(el({ attributes }));
    const attrLine = out.split("\n").find((l) => l.startsWith("- Attributes:"));
    expect(attrLine).toBeDefined();
    expect((attrLine!.match(/data-a\d+=/g) || []).length).toBe(8);
  });
});
