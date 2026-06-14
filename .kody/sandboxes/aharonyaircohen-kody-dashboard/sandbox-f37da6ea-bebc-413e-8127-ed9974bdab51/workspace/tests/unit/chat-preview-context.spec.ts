import { describe, expect, it } from "vitest";

import { previewChatContextBlock } from "@dashboard/lib/chat/preview-context";
import type { PreviewEnvironment } from "@dashboard/lib/preview-environments";

describe("previewChatContextBlock", () => {
  it("returns null when there is no active preview", () => {
    expect(previewChatContextBlock(null)).toBeNull();
  });

  it("describes an uploaded preview with its file outline", () => {
    const env: PreviewEnvironment = {
      id: "landing",
      label: "landing.html",
      url: "https://kp-landing.fly.dev",
      staticId: "abc123",
      expiresAt: 1_700_000_000_000,
      uploadContext: {
        name: "landing.html",
        mimeType: "text/html",
        size: 2048,
        title: "Landing",
        outline: "h1: Welcome\nbutton: Start",
      },
    };

    const block = previewChatContextBlock(env);

    expect(block).toContain("uploaded preview");
    expect(block).toContain("landing.html");
    expect(block).toContain("https://kp-landing.fly.dev");
    expect(block).toContain("Landing");
    expect(block).toContain("button: Start");
  });

  it("describes plain preview environments too", () => {
    const block = previewChatContextBlock({
      id: "prod",
      label: "Production",
      url: "https://prod.example.com",
    });

    expect(block).toContain("Production");
    expect(block).toContain("https://prod.example.com");
    expect(block).not.toContain("Uploaded file");
  });
});
