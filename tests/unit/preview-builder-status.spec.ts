import { afterEach, describe, expect, it, vi } from "vitest";

import { getPreviewBuilderStatus } from "@dashboard/lib/previews/builder-client";

describe("getPreviewBuilderStatus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the newest active builder for the requested preview app", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: "old-builder",
          state: "started",
          created_at: "2026-06-23T13:00:00Z",
          config: { env: { APP_NAME: "kp-x-y-pr-1" } },
        },
        {
          id: "new-builder",
          state: "started",
          created_at: "2026-06-23T13:39:18Z",
          config: { env: { APP_NAME: "kp-x-y-pr-1" } },
        },
        {
          id: "other-builder",
          state: "started",
          created_at: "2026-06-23T14:00:00Z",
          config: { env: { APP_NAME: "kp-x-y-pr-2" } },
        },
      ],
    } as Response);

    await expect(
      getPreviewBuilderStatus("kp-x-y-pr-1", "fly-token"),
    ).resolves.toEqual({
      state: "building",
      machineId: "new-builder",
      machineState: "started",
      createdAt: "2026-06-23T13:39:18Z",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.machines.dev/v1/apps/kody-preview-builder/machines",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer fly-token" }),
      }),
    );
  });

  it("treats a stopped builder as a failed build", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: "builder-1",
          state: "stopped",
          created_at: "2026-06-23T13:39:18Z",
          config: { env: { APP_NAME: "kp-x-y-pr-1" } },
        },
      ],
    } as Response);

    await expect(
      getPreviewBuilderStatus("kp-x-y-pr-1", "fly-token"),
    ).resolves.toMatchObject({
      state: "failed",
      machineId: "builder-1",
    });
  });
});
