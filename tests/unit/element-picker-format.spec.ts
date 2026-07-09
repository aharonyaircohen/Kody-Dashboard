/**
 * Unit tests for formatPickedElement (src/dashboard/lib/picker/protocol.ts) —
 * the pure function that turns a picked DOM element into the chat context
 * block. The cross-frame plumbing (extension + hook) needs a real browser, so
 * it's covered by manual/E2E; this locks the formatting contract.
 */
import { describe, it, expect } from "vitest";
import {
  formatPickedElement,
  formatLogs,
  formatNetwork,
  formatPerf,
  formatPlaywrightTest,
  formatPreviewActResult,
  formatPreviewEditRequest,
  type PickedElement,
  type PerfReport,
  type PreviewEditChange,
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
    expect(out.startsWith("I'm pointing at this element in the preview")).toBe(
      true,
    );
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

describe("formatLogs", () => {
  it("renders entries in a fenced block with level prefixes and a count", () => {
    const out = formatLogs([
      { level: "error", message: "Boom", ts: 1 },
      { level: "warn", message: "Careful", ts: 2 },
    ]);
    expect(out).toContain("2 entries");
    expect(out).toContain("[error] Boom");
    expect(out).toContain("[warn] Careful");
    expect(out.match(/```/g)?.length).toBe(2);
  });

  it("uses singular wording for a single entry", () => {
    expect(formatLogs([{ level: "error", message: "x", ts: 1 }])).toContain(
      "1 entry",
    );
  });
});

describe("formatPreviewEditRequest", () => {
  it("renders structured preview edits as repo-change context", () => {
    const changes: PreviewEditChange[] = [
      {
        id: "1",
        label: "<button>",
        selector: "div > button:nth-of-type(2)",
        url: "https://preview.example.com/",
        mutation: {
          op: "style",
          styles: { color: "red", padding: "12px" },
        },
      },
      {
        id: "2",
        label: "<button>",
        selector: "div > button:nth-of-type(2)",
        url: "https://preview.example.com/",
        mutation: { op: "text", value: "Start now" },
      },
    ];

    const out = formatPreviewEditRequest(
      el({ text: "Start", selector: "div > button:nth-of-type(2)" }),
      changes,
    );

    expect(out).toContain("temporary visual edits");
    expect(out).toContain("- Target: <button>");
    expect(out).toContain("Style color: red, padding: 12px");
    expect(out).toContain('Change text to "Start now"');
    expect(out).toContain("real repo code");
  });
});

describe("formatPreviewActResult", () => {
  it("labels post-action page info as observation, not a user request", () => {
    const out = formatPreviewActResult(
      { op: "click", selector: "button.save" },
      {
        ok: true,
        info: {
          url: "https://preview.example.com/",
          title: "Preview",
          selection: "",
          dom: 'Button "Save"',
        },
      },
    );

    expect(out).toContain("Preview observation after that action");
    expect(out).toContain("it is not a new user request");
    expect(out).toContain('Button "Save"');
  });
});

describe("formatNetwork", () => {
  it("renders method/url/status and a count", () => {
    const out = formatNetwork([
      { url: "https://api/x", method: "GET", status: 500, ts: 1 },
    ]);
    expect(out).toContain("1 request");
    expect(out).toContain("GET https://api/x → 500");
  });

  it("shows ERR + reason when the request threw (status 0)", () => {
    const out = formatNetwork([
      {
        url: "https://api/y",
        method: "POST",
        status: 0,
        error: "TypeError",
        ts: 1,
      },
    ]);
    expect(out).toContain("POST https://api/y → ERR TypeError");
  });
});

function perf(overrides: Partial<PerfReport> = {}): PerfReport {
  return {
    url: "https://preview/",
    ttfbMs: 120,
    domContentLoadedMs: 800,
    loadMs: 2300,
    fcpMs: 900,
    lcpMs: 2500,
    resourceCount: 42,
    totalBytes: 1024 * 1024 * 2,
    slowest: [
      {
        url: "https://preview/main.js",
        type: "script",
        durationMs: 1800,
        bytes: 512 * 1024,
      },
    ],
    ...overrides,
  };
}

describe("formatPerf", () => {
  it("renders timings with s/ms units and lists slowest resources", () => {
    const out = formatPerf(perf());
    expect(out).toContain("TTFB: 120ms");
    expect(out).toContain("Largest Contentful Paint: 2.50s");
    expect(out).toContain("Load: 2.30s");
    expect(out).toContain("2.0MB transferred");
    expect(out).toContain("main.js");
  });

  it("shows 'still loading' when loadMs is 0 and n/a LCP when missing", () => {
    const out = formatPerf(perf({ loadMs: 0, lcpMs: 0 }));
    expect(out).toContain("Load: still loading");
    expect(out).toContain("Largest Contentful Paint: n/a");
  });
});

describe("formatPlaywrightTest", () => {
  it("emits goto + click/fill calls with escaped quotes", () => {
    const out = formatPlaywrightTest(
      [
        { type: "click", selector: "button.cta", text: "Buy" },
        { type: "fill", selector: "input#email", value: "a@b.co" },
      ],
      "https://preview/checkout",
    );
    expect(out).toContain("await page.goto('https://preview/checkout');");
    expect(out).toContain("await page.click('button.cta');");
    expect(out).toContain("await page.fill('input#email', 'a@b.co');");
    expect(out).toContain("import { test, expect } from '@playwright/test';");
  });

  it("escapes single quotes in selectors/values", () => {
    const out = formatPlaywrightTest(
      [{ type: "fill", selector: "input[name='q']", value: "it's" }],
      "https://preview/",
    );
    expect(out).toContain("input[name=\\'q\\']");
    expect(out).toContain("it\\'s");
  });
});
