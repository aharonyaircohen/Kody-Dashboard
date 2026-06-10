import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolvePreviewConfigForRepo: vi.fn(),
  resolveBackgroundToken: vi.fn(),
  routePreviewBuild: vi.fn(),
  sweepExpiredPreviews: vi.fn(),
}));

vi.mock("@dashboard/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("@dashboard/lib/previews/config", () => ({
  resolvePreviewConfigForRepo: mocks.resolvePreviewConfigForRepo,
}));
vi.mock("@dashboard/lib/auth/background-token", () => ({
  resolveBackgroundToken: mocks.resolveBackgroundToken,
}));
vi.mock("@dashboard/lib/previews/preview-router", () => ({
  routePreviewBuild: mocks.routePreviewBuild,
}));
vi.mock("@dashboard/lib/previews/sweep", () => ({
  sweepExpiredPreviews: mocks.sweepExpiredPreviews,
}));
vi.mock("@dashboard/lib/runners/fly-inventory", () => ({
  listFlyInventory: vi.fn(),
}));
vi.mock("@dashboard/lib/runners/fly-activity-store", () => ({
  readActivityFile: vi.fn(),
  recordSnapshot: vi.fn(),
  snapshotDue: vi.fn(() => false),
  snapshotFromInventory: vi.fn(),
}));

import { handlePrOpenedOrSynced } from "@dashboard/lib/previews/webhook";

describe("preview webhook maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolvePreviewConfigForRepo.mockResolvedValue({
      token: "fly-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    });
    mocks.resolveBackgroundToken.mockResolvedValue(null);
    mocks.routePreviewBuild.mockResolvedValue({
      runner: "fly",
      reason: "fly preferred",
      flyUrl: "https://kp.fly.dev",
    });
    mocks.sweepExpiredPreviews.mockResolvedValue({
      enabled: true,
      ttlDays: 14,
      inspected: 0,
      destroyed: [],
      aligned: [],
      unchanged: [],
      skipped: [],
      errored: [],
    });
  });

  it("still sweeps expired previews when the router path handles the build", async () => {
    await handlePrOpenedOrSynced({
      repoFullName: "acme/widgets",
      prNumber: 7,
      ref: "abc1234",
    });

    expect(mocks.routePreviewBuild).toHaveBeenCalledOnce();
    expect(mocks.sweepExpiredPreviews).toHaveBeenCalledWith("acme/widgets");
  });
});
