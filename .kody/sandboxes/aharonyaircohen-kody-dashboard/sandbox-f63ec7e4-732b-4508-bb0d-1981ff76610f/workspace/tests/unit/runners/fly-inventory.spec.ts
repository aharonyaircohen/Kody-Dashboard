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
});
