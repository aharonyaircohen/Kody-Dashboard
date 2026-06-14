import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveFlyPreviewsForRepo: vi.fn(),
  resolvePreviewConfigForRepo: vi.fn(),
  listAppsByPrefix: vi.fn(),
  listMachines: vi.fn(),
  destroyApp: vi.fn(),
  alignPreviewMachineSleep: vi.fn(),
  sleepPreviewMachine: vi.fn(),
}));

vi.mock("@dashboard/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("@dashboard/lib/previews/config", () => ({
  resolveFlyPreviewsForRepo: mocks.resolveFlyPreviewsForRepo,
  resolvePreviewConfigForRepo: mocks.resolvePreviewConfigForRepo,
}));
vi.mock("@dashboard/lib/previews/fly-previews", () => ({
  listAppsByPrefix: mocks.listAppsByPrefix,
  listMachines: mocks.listMachines,
  destroyApp: mocks.destroyApp,
  alignPreviewMachineSleep: mocks.alignPreviewMachineSleep,
  sleepPreviewMachine: mocks.sleepPreviewMachine,
}));

import { sweepExpiredPreviews } from "@dashboard/lib/previews/sweep";

const CFG = {
  token: "fly-token",
  orgSlug: "personal",
  defaultRegion: "fra",
};

describe("sweepExpiredPreviews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveFlyPreviewsForRepo.mockResolvedValue({
      cpus: 2,
      memoryMb: 2048,
      idleSuspend: true,
      healthCheck: false,
      ttlDays: 14,
    });
    mocks.resolvePreviewConfigForRepo.mockResolvedValue(CFG);
    mocks.alignPreviewMachineSleep.mockResolvedValue({
      changed: true,
      skipped: false,
    });
    mocks.sleepPreviewMachine.mockResolvedValue({
      slept: true,
      mode: "suspend",
    });
  });

  it("repairs and sleeps live previews, then destroys expired previews", async () => {
    const now = Date.parse("2026-06-10T00:00:00.000Z");
    const fresh = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
    const expired = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

    mocks.listAppsByPrefix.mockResolvedValue([
      "kp-repo-pr-1",
      "kp-repo-pr-2",
      "kp-repo-base",
    ]);
    mocks.listMachines.mockImplementation(async (appName: string) => {
      if (appName === "kp-repo-pr-1") {
        return [
          {
            id: "m-fresh",
            state: "started",
            region: "fra",
            createdAt: fresh,
            guest: { memoryMb: 2048 },
          },
        ];
      }
      return [
        {
          id: "m-expired",
          state: "started",
          region: "fra",
          createdAt: expired,
          guest: { memoryMb: 2048 },
        },
      ];
    });

    const result = await sweepExpiredPreviews("acme/widgets", now);

    expect(mocks.destroyApp).toHaveBeenCalledWith("kp-repo-pr-2", CFG);
    expect(mocks.alignPreviewMachineSleep).toHaveBeenCalledWith(
      "kp-repo-pr-1",
      "m-fresh",
      CFG,
      { idleSuspend: true, healthCheck: false, memoryMb: 2048 },
    );
    expect(mocks.sleepPreviewMachine).toHaveBeenCalledWith(
      "kp-repo-pr-1",
      "m-fresh",
      CFG,
      { state: "started", memoryMb: 2048 },
    );
    expect(mocks.alignPreviewMachineSleep).not.toHaveBeenCalledWith(
      "kp-repo-pr-2",
      "m-expired",
      expect.anything(),
      expect.anything(),
    );
    expect(result).toMatchObject({
      enabled: true,
      ttlDays: 14,
      inspected: 2,
      destroyed: ["kp-repo-pr-2"],
      aligned: ["kp-repo-pr-1/m-fresh"],
      unchanged: [],
      skipped: [],
      slept: ["kp-repo-pr-1/m-fresh"],
      errored: [],
    });
  });

  it("tracks unchanged and skipped machine repairs", async () => {
    const now = Date.parse("2026-06-10T00:00:00.000Z");
    const fresh = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();

    mocks.listAppsByPrefix.mockResolvedValue(["kp-repo-pr-1"]);
    mocks.listMachines.mockResolvedValue([
      {
        id: "m-ok",
        state: "suspended",
        region: "fra",
        createdAt: fresh,
        guest: { memoryMb: 2048 },
      },
      {
        id: "m-skip",
        state: "started",
        region: "fra",
        createdAt: fresh,
        guest: { memoryMb: 2048 },
      },
    ]);
    mocks.alignPreviewMachineSleep
      .mockResolvedValueOnce({ changed: false, skipped: false })
      .mockResolvedValueOnce({
        changed: false,
        skipped: true,
        reason: "missing_services",
      });
    mocks.sleepPreviewMachine.mockResolvedValueOnce({
      slept: false,
      reason: "not_started",
    });

    const result = await sweepExpiredPreviews("acme/widgets", now);

    expect(result).toMatchObject({
      aligned: [],
      unchanged: ["kp-repo-pr-1/m-ok"],
      skipped: ["kp-repo-pr-1/m-skip"],
      slept: [],
      destroyed: [],
      errored: [],
    });
    expect(mocks.sleepPreviewMachine).toHaveBeenCalledTimes(1);
    expect(mocks.sleepPreviewMachine).toHaveBeenCalledWith(
      "kp-repo-pr-1",
      "m-ok",
      CFG,
      { state: "suspended", memoryMb: 2048 },
    );
  });

  it("records app errors and keeps sweeping the rest", async () => {
    const now = Date.parse("2026-06-10T00:00:00.000Z");
    const fresh = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();

    mocks.listAppsByPrefix.mockResolvedValue(["kp-repo-pr-bad", "kp-repo-pr-ok"]);
    mocks.listMachines.mockImplementation(async (appName: string) => {
      if (appName === "kp-repo-pr-bad") throw new Error("fly down");
      return [
        {
          id: "m-ok",
          state: "started",
          region: "fra",
          createdAt: fresh,
          guest: { memoryMb: 4096 },
        },
      ];
    });

    const result = await sweepExpiredPreviews("acme/widgets", now);

    expect(mocks.alignPreviewMachineSleep).toHaveBeenCalledWith(
      "kp-repo-pr-ok",
      "m-ok",
      CFG,
      { idleSuspend: true, healthCheck: false, memoryMb: 4096 },
    );
    expect(result.errored).toEqual(["kp-repo-pr-bad"]);
    expect(result.aligned).toEqual(["kp-repo-pr-ok/m-ok"]);
    expect(result.slept).toEqual(["kp-repo-pr-ok/m-ok"]);
  });

  it("does not sleep repaired previews when idle sleep is disabled", async () => {
    const now = Date.parse("2026-06-10T00:00:00.000Z");
    const fresh = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();

    mocks.resolveFlyPreviewsForRepo.mockResolvedValue({
      cpus: 2,
      memoryMb: 2048,
      idleSuspend: false,
      healthCheck: false,
      ttlDays: 14,
    });
    mocks.listAppsByPrefix.mockResolvedValue(["kp-repo-pr-1"]);
    mocks.listMachines.mockResolvedValue([
      {
        id: "m-live",
        state: "started",
        region: "fra",
        createdAt: fresh,
        guest: { memoryMb: 2048 },
      },
    ]);

    const result = await sweepExpiredPreviews("acme/widgets", now);

    expect(mocks.alignPreviewMachineSleep).toHaveBeenCalledWith(
      "kp-repo-pr-1",
      "m-live",
      CFG,
      { idleSuspend: false, healthCheck: false, memoryMb: 2048 },
    );
    expect(mocks.sleepPreviewMachine).not.toHaveBeenCalled();
    expect(result.slept).toEqual([]);
  });
});
