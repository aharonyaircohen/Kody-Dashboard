import { beforeEach, describe, expect, it, vi } from "vitest";

const fly = vi.hoisted(() => ({
  appExists: vi.fn(),
  flyHostname: vi.fn((appName: string) => `https://${appName}.fly.dev`),
  listMachines: vi.fn(),
}));

const builder = vi.hoisted(() => ({
  getPreviewBuilderStatus: vi.fn(),
}));

vi.mock("@dashboard/lib/previews/fly-previews", () => fly);
vi.mock("@dashboard/lib/previews/builder-client", () => builder);
vi.mock("@dashboard/lib/previews/vault-build-context", () => ({
  loadVaultContextForBuild: vi.fn(),
}));
vi.mock("@dashboard/lib/previews/config", () => ({
  resolveFlyPreviewsForRepo: vi.fn(),
}));

import { getPreview } from "@dashboard/lib/previews/preview-lifecycle";

const cfg = {
  token: "fly-token",
  orgSlug: "personal",
  defaultRegion: "fra",
};

describe("getPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fly.appExists.mockResolvedValue(true);
    fly.listMachines.mockResolvedValue([]);
    builder.getPreviewBuilderStatus.mockResolvedValue(null);
  });

  it("reports a preview as building when the app exists but only the builder is running", async () => {
    builder.getPreviewBuilderStatus.mockResolvedValue({
      state: "building",
      machineId: "builder-1",
      machineState: "started",
    });

    const info = await getPreview(
      { repo: "A-Guy-educ/A-Guy-Web", pr: 325 },
      cfg,
    );

    expect(info).toMatchObject({
      appName: "kp-866cab-523991-pr-325",
      state: "building",
      url: null,
      builderMachineId: "builder-1",
      region: "fra",
    });
  });

  it("reports a dead empty app as failed instead of returning a dead Fly URL", async () => {
    const info = await getPreview(
      { repo: "A-Guy-educ/A-Guy-Web", pr: 325 },
      cfg,
    );

    expect(info).toMatchObject({
      appName: "kp-866cab-523991-pr-325",
      state: "failed",
      url: null,
      region: "fra",
    });
  });

  it("still returns the Fly URL when a preview machine exists", async () => {
    fly.listMachines.mockResolvedValue([
      { id: "machine-1", state: "started", region: "fra" },
    ]);

    const info = await getPreview(
      { repo: "A-Guy-educ/A-Guy-Web", pr: 325 },
      cfg,
    );

    expect(info).toMatchObject({
      machineId: "machine-1",
      state: "running",
      url: "https://kp-866cab-523991-pr-325.fly.dev",
    });
    expect(builder.getPreviewBuilderStatus).not.toHaveBeenCalled();
  });
});
