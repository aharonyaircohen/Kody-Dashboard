import { describe, expect, it } from "vitest";

import { previewChatContextBlock } from "@dashboard/lib/chat/core/preview-context";
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

  it("puts repo-backed static view source before the preview URL", () => {
    const block = previewChatContextBlock({
      id: "mobile",
      label: "Mobile HTML",
      url: "/api/kody/views/mobile-html-1234/index.html",
      repoViewPath: "views/mobile-html-1234",
      repoViewEntryPath: "index.html",
      repoViewSourceUrl:
        "https://github.com/acme/kody-state/blob/main/app/views/mobile-html-1234/index.html",
    });

    expect(block).toContain("Source path: views/mobile-html-1234");
    expect(block).toContain("Entry file: index.html");
    expect(block).toContain(
      "Source URL: https://github.com/acme/kody-state/blob/main/app/views/mobile-html-1234/index.html",
    );
    expect(block).toContain(
      "Preview URL: /api/kody/views/mobile-html-1234/index.html",
    );
    expect(block!.indexOf("Source URL")).toBeLessThan(
      block!.indexOf("Preview URL"),
    );
  });

  it("describes Fly branch previews without requiring a URL", () => {
    const block = previewChatContextBlock({
      id: "dev",
      label: "dev",
      flyBranch: { repo: "owner/repo", branch: "dev" },
    });

    expect(block).toContain("Fly branch preview");
    expect(block).toContain("owner/repo");
    expect(block).toContain("dev");
    expect(block).not.toContain("Preview URL");
  });
});
