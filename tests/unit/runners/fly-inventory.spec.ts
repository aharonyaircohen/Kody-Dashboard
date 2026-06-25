import { beforeEach, describe, expect, it, vi } from "vitest";

const listAppsByPrefix = vi.fn();
const listMachines = vi.fn();

vi.mock("@dashboard/lib/previews/fly-previews", () => ({
  listAppsByPrefix: (...args: unknown[]) => listAppsByPrefix(...args),
  listMachines: (...args: unknown[]) => listMachines(...args),
}));

import {
  classifyApp,
  listFlyInventory,
  rowsForFlyApp,
} from "@dashboard/lib/runners/fly-inventory";
import type { FlyPreviewConfig } from "@dashboard/lib/previews/fly-previews";

const cfg: FlyPreviewConfig = {
  token: "fly_test",
  orgSlug: "personal",
  defaultRegion: "fra",
};

beforeEach(() => {
  listAppsByPrefix.mockReset();
  listMachines.mockReset();
});

describe("fly inventory", () => {
  it("classifies only supported kody app families", () => {
    expect(classifyApp("kody-runner")).toMatchObject({ feature: "runner" });
    expect(classifyApp("kody-brain-alice")).toMatchObject({
      feature: "brain",
    });
    expect(classifyApp("kody-preview-builder")).toMatchObject({
      feature: "builder",
    });
    expect(classifyApp("kody-old-service")).toMatchObject({
      feature: "other",
    });
  });

  it("does not list unsupported kody-* service apps", async () => {
    listAppsByPrefix.mockResolvedValue([
      "kody-runner",
      "kody-brain-alice",
      "kody-old-service",
      "kp-a-b-pr-7",
    ]);
    listMachines.mockResolvedValue([
      {
        id: "m1",
        state: "started",
        region: "fra",
        guest: { cpuKind: "shared", cpus: 1, memoryMb: 512 },
      },
    ]);

    const out = await listFlyInventory(cfg);

    expect(out.machines.map((m) => m.app)).toEqual([
      "kody-runner",
      "kody-brain-alice",
      "kp-a-b-pr-7",
    ]);
    expect(listMachines).not.toHaveBeenCalledWith(
      "kody-old-service",
      expect.anything(),
    );
  });

  it("can build a Brain row from a directly-known app", () => {
    const rows = rowsForFlyApp(
      "local-2",
      [
        {
          id: "m-brain",
          state: "started",
          region: "fra",
          name: "brain-fra",
          guest: { cpuKind: "performance", cpus: 1, memoryMb: 2048 },
          createdAt: "2026-06-24T20:10:02Z",
        },
      ],
      Date.parse("2026-06-24T20:10:12Z"),
      { feature: "brain", label: "local-2" },
    );

    expect(rows).toEqual([
      expect.objectContaining({
        feature: "brain",
        app: "local-2",
        machineId: "m-brain",
        name: "brain-fra",
        label: "local-2",
        sizeLabel: "perf 1x · 2 GB",
      }),
    ]);
  });
});
