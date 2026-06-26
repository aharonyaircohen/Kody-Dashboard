import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FlyPreviewConfig } from "@dashboard/lib/previews/fly-previews";
import type { GitHubPR } from "@dashboard/lib/types";

const lifecycle = vi.hoisted(() => ({
  getPreview: vi.fn(),
}));

vi.mock("@dashboard/lib/previews/preview-lifecycle", () => lifecycle);

import { buildPreviewUrlByPrNumber } from "@dashboard/lib/tasks/preview-urls";

const flyConfig: FlyPreviewConfig = {
  token: "fly-token",
  orgSlug: "personal",
  defaultRegion: "fra",
};

function pr(number: number, sha: string): Pick<GitHubPR, "number" | "head"> {
  return {
    number,
    head: { ref: `pr-${number}`, sha },
  };
}

describe("buildPreviewUrlByPrNumber", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not fabricate a Fly URL when no preview app exists", async () => {
    lifecycle.getPreview.mockResolvedValue(null);

    const urls = await buildPreviewUrlByPrNumber({
      openPRs: [pr(335, "sha-335")],
      deploymentPreviewUrls: new Map(),
      flyPreviewConfig: flyConfig,
      repo: "A-Guy-educ/A-Guy-Web",
    });

    expect(urls.has(335)).toBe(false);
    expect(lifecycle.getPreview).toHaveBeenCalledWith(
      { repo: "A-Guy-educ/A-Guy-Web", pr: 335 },
      flyConfig,
    );
  });

  it("falls back to deployment previews when Fly is not ready", async () => {
    lifecycle.getPreview.mockResolvedValue({
      appName: "kp-866cab-523991-pr-335",
      state: "failed",
      url: null,
      region: "fra",
    });

    const urls = await buildPreviewUrlByPrNumber({
      openPRs: [pr(335, "sha-335")],
      deploymentPreviewUrls: new Map([
        ["sha-335", "https://a-guy-web-git-pr-335.vercel.app"],
      ]),
      flyPreviewConfig: flyConfig,
      repo: "A-Guy-educ/A-Guy-Web",
    });

    expect(urls.get(335)).toBe("https://a-guy-web-git-pr-335.vercel.app");
  });

  it("prefers the Fly URL only after Fly reports one", async () => {
    lifecycle.getPreview.mockResolvedValue({
      appName: "kp-866cab-523991-pr-335",
      state: "running",
      url: "https://kp-866cab-523991-pr-335.fly.dev",
      region: "fra",
    });

    const urls = await buildPreviewUrlByPrNumber({
      openPRs: [pr(335, "sha-335")],
      deploymentPreviewUrls: new Map([
        ["sha-335", "https://a-guy-web-git-pr-335.vercel.app"],
      ]),
      flyPreviewConfig: flyConfig,
      repo: "A-Guy-educ/A-Guy-Web",
    });

    expect(urls.get(335)).toBe("https://kp-866cab-523991-pr-335.fly.dev");
  });

  it("signs ready Fly URLs when a signer is provided", async () => {
    lifecycle.getPreview.mockResolvedValue({
      appName: "kp-866cab-523991-pr-335",
      state: "running",
      url: "https://kp-866cab-523991-pr-335.fly.dev",
      region: "fra",
    });
    const signFlyPreviewUrl = vi.fn(({ url, pr: prNumber }) => {
      return `${url}?kp=ticket-${prNumber}`;
    });

    const urls = await buildPreviewUrlByPrNumber({
      openPRs: [pr(335, "sha-335")],
      deploymentPreviewUrls: new Map(),
      flyPreviewConfig: flyConfig,
      repo: "A-Guy-educ/A-Guy-Web",
      signFlyPreviewUrl,
    });

    expect(signFlyPreviewUrl).toHaveBeenCalledWith({
      repo: "A-Guy-educ/A-Guy-Web",
      pr: 335,
      url: "https://kp-866cab-523991-pr-335.fly.dev",
    });
    expect(urls.get(335)).toBe(
      "https://kp-866cab-523991-pr-335.fly.dev?kp=ticket-335",
    );
  });

  it("falls back to deployment previews when Fly signing fails", async () => {
    lifecycle.getPreview.mockResolvedValue({
      appName: "kp-866cab-523991-pr-335",
      state: "running",
      url: "https://kp-866cab-523991-pr-335.fly.dev",
      region: "fra",
    });

    const urls = await buildPreviewUrlByPrNumber({
      openPRs: [pr(335, "sha-335")],
      deploymentPreviewUrls: new Map([
        ["sha-335", "https://a-guy-web-git-pr-335.vercel.app"],
      ]),
      flyPreviewConfig: flyConfig,
      repo: "A-Guy-educ/A-Guy-Web",
      signFlyPreviewUrl: () => {
        throw new Error("missing master key");
      },
    });

    expect(urls.get(335)).toBe("https://a-guy-web-git-pr-335.vercel.app");
  });

  it("falls back to deployment previews when Fly lookup fails", async () => {
    lifecycle.getPreview.mockRejectedValue(new Error("fly api unavailable"));

    const urls = await buildPreviewUrlByPrNumber({
      openPRs: [pr(335, "sha-335")],
      deploymentPreviewUrls: new Map([
        ["sha-335", "https://a-guy-web-git-pr-335.vercel.app"],
      ]),
      flyPreviewConfig: flyConfig,
      repo: "A-Guy-educ/A-Guy-Web",
    });

    expect(urls.get(335)).toBe("https://a-guy-web-git-pr-335.vercel.app");
  });
});
