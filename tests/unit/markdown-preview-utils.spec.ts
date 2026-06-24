import { describe, expect, it } from "vitest";

import {
  detectCalloutKind,
  extractCodeLanguage,
  slugifyHeading,
  stripCalloutMarker,
} from "@dashboard/lib/markdown-preview-utils";

describe("markdown preview utilities", () => {
  it("extracts fenced code languages from react-markdown class names", () => {
    expect(extractCodeLanguage("language-ts")).toBe("ts");
    expect(extractCodeLanguage("foo language-mermaid bar")).toBe("mermaid");
    expect(extractCodeLanguage(undefined)).toBeNull();
  });

  it("detects and removes GitHub alert markers", () => {
    expect(detectCalloutKind("[!WARNING]")).toBe("warning");
    expect(detectCalloutKind(" [!TIP] keep going")).toBe("tip");
    expect(detectCalloutKind("ordinary quote")).toBeNull();
    expect(stripCalloutMarker("[!NOTE] hello")).toBe("hello");
  });

  it("creates stable heading anchors", () => {
    expect(slugifyHeading("## Kody Chat: What's New?")).toBe(
      "kody-chat-whats-new",
    );
    expect(slugifyHeading("")).toBe("section");
  });
});
