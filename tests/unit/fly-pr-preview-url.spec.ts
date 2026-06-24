import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({
  resolvePreviewConfigForOctokit: vi.fn(),
}));

const lifecycle = vi.hoisted(() => ({
  getPreview: vi.fn(),
}));

vi.mock("@dashboard/lib/previews/config", () => config);
vi.mock("@dashboard/lib/previews/preview-lifecycle", () => lifecycle);

import { flyPrPreviewUrl } from "@dashboard/lib/previews/fly-pr-preview-url";

describe("flyPrPreviewUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.resolvePreviewConfigForOctokit.mockResolvedValue({
      token: "fly-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    });
  });

  it("does not return a Fly URL while the preview is still building", async () => {
    lifecycle.getPreview.mockResolvedValue({
      appName: "kp-x-y-pr-325",
      state: "building",
      url: null,
    });

    await expect(
      flyPrPreviewUrl({} as never, "A-Guy-educ", "A-Guy-Web", 325),
    ).resolves.toBeNull();
  });

  it("returns the Fly URL only after a preview machine exists", async () => {
    lifecycle.getPreview.mockResolvedValue({
      appName: "kp-x-y-pr-325",
      state: "running",
      url: "https://kp-x-y-pr-325.fly.dev",
    });

    await expect(
      flyPrPreviewUrl({} as never, "A-Guy-educ", "A-Guy-Web", 325),
    ).resolves.toBe("https://kp-x-y-pr-325.fly.dev");
  });
});
