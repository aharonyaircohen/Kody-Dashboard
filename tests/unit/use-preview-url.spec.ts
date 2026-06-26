import { describe, expect, it } from "vitest";

import { safePreviewUrl } from "@dashboard/lib/hooks/usePreviewUrl";

describe("safePreviewUrl", () => {
  it("keeps non-Fly preview URLs", () => {
    expect(safePreviewUrl("https://example.vercel.app")).toBe(
      "https://example.vercel.app",
    );
  });

  it("keeps signed Fly preview URLs", () => {
    expect(safePreviewUrl("https://kp-test.fly.dev/?kp=ticket")).toBe(
      "https://kp-test.fly.dev/?kp=ticket",
    );
  });

  it("drops unsigned Fly preview URLs", () => {
    expect(safePreviewUrl("https://kp-test.fly.dev/")).toBeNull();
  });
});
