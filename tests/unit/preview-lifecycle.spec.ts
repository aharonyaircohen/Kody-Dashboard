import { beforeEach, describe, expect, it, vi } from "vitest";

const fly = vi.hoisted(() => ({
  appExists: vi.fn(),
  flyHostname: vi.fn((appName: string) => `https://${appName}.fly.dev`),
  listMachines: vi.fn(),
  startMachine: vi.fn(),
  waitForMachineStarted: vi.fn(),
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

import {
  getPreview,
  wakePreview,
} from "@dashboard/lib/previews/preview-lifecycle";

const cfg = {
  token: "fly-token",
  orgSlug: "personal",
  defaultRegion: "fra",
};

const key = { repo: "A-Guy-educ/A-Guy-Web", pr: 325 };
const appName = "kp-866cab-523991-pr-325";

describe("getPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fly.appExists.mockResolvedValue(true);
    fly.listMachines.mockResolvedValue([]);
    fly.waitForMachineStarted.mockResolvedValue(undefined);
    builder.getPreviewBuilderStatus.mockResolvedValue(null);
  });

  it("reports a preview as building when the app exists but only the builder is running", async () => {
    builder.getPreviewBuilderStatus.mockResolvedValue({
      state: "building",
      machineId: "builder-1",
      machineState: "started",
    });

    const info = await getPreview(key, cfg);

    expect(info).toMatchObject({
      appName,
      state: "building",
      url: null,
      builderMachineId: "builder-1",
      region: "fra",
    });
  });

  it("reports a dead empty app as failed instead of returning a dead Fly URL", async () => {
    const info = await getPreview(key, cfg);

    expect(info).toMatchObject({
      appName,
      state: "failed",
      url: null,
      region: "fra",
    });
  });

  it("still returns the Fly URL when a preview machine exists", async () => {
    fly.listMachines.mockResolvedValue([
      { id: "machine-1", state: "started", region: "fra" },
    ]);

    const info = await getPreview(key, cfg);

    expect(info).toMatchObject({
      machineId: "machine-1",
      state: "running",
      url: `https://${appName}.fly.dev`,
    });
    expect(builder.getPreviewBuilderStatus).not.toHaveBeenCalled();
  });

  it("keeps read-only status lookups from waking suspended preview machines", async () => {
    fly.listMachines.mockResolvedValue([
      { id: "machine-1", state: "suspended", region: "fra" },
    ]);

    const info = await getPreview(key, cfg);

    expect(info).toMatchObject({
      machineId: "machine-1",
      state: "unknown",
      url: `https://${appName}.fly.dev`,
    });
    expect(fly.startMachine).not.toHaveBeenCalled();
    expect(fly.waitForMachineStarted).not.toHaveBeenCalled();
  });
});

describe("wakePreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fly.appExists.mockResolvedValue(true);
    fly.waitForMachineStarted.mockResolvedValue(undefined);
    builder.getPreviewBuilderStatus.mockResolvedValue(null);
  });

  it("starts a suspended preview machine and returns the refreshed running state", async () => {
    fly.listMachines
      .mockResolvedValueOnce([
        { id: "machine-1", state: "suspended", region: "fra" },
      ])
      .mockResolvedValueOnce([
        { id: "machine-1", state: "started", region: "fra" },
      ]);

    const info = await wakePreview(key, cfg);

    expect(fly.startMachine).toHaveBeenCalledWith(appName, "machine-1", cfg);
    expect(fly.waitForMachineStarted).toHaveBeenCalledWith(
      appName,
      "machine-1",
      cfg,
      20_000,
    );
    expect(info).toMatchObject({
      machineId: "machine-1",
      state: "running",
      url: `https://${appName}.fly.dev`,
    });
  });

  it("waits for an already-starting preview without sending another start", async () => {
    fly.listMachines
      .mockResolvedValueOnce([
        { id: "machine-1", state: "starting", region: "fra" },
      ])
      .mockResolvedValueOnce([
        { id: "machine-1", state: "started", region: "fra" },
      ]);

    const info = await wakePreview(key, cfg);

    expect(fly.startMachine).not.toHaveBeenCalled();
    expect(fly.waitForMachineStarted).toHaveBeenCalled();
    expect(info).toMatchObject({ state: "running" });
  });
});
