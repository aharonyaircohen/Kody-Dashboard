/**
 * @fileoverview Unit coverage for saved Brain image metadata.
 * @testFramework vitest
 * @domain brain
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getOctokit: vi.fn(() => ({ id: "octokit" })),
  getOwner: vi.fn(() => "aharonyaircohen"),
  getRepo: vi.fn(() => "Kody-Dashboard"),
  readStateText: vi.fn(),
  writeStateText: vi.fn(),
  deleteStateFile: vi.fn(),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  getOctokit: state.getOctokit,
  getOwner: state.getOwner,
  getRepo: state.getRepo,
}));

vi.mock("@dashboard/lib/state-repo", () => ({
  deleteStateFile: state.deleteStateFile,
  readStateText: state.readStateText,
  writeStateText: state.writeStateText,
}));

describe("Brain image store", () => {
  beforeEach(() => {
    vi.resetModules();
    state.getOctokit.mockReturnValue({ id: "octokit" });
    state.getOwner.mockReturnValue("aharonyaircohen");
    state.getRepo.mockReturnValue("Kody-Dashboard");
    state.readStateText.mockReset();
    state.writeStateText.mockReset();
    state.deleteStateFile.mockReset();
  });

  it("reads the per-user Brain image record from kody-state", async () => {
    state.readStateText.mockResolvedValue({
      content: JSON.stringify({
        version: 1,
        imageRef: "ghcr.io/alice/kody-brain-snapshot:20260625",
        createdAt: "2026-06-25T10:00:00.000Z",
        updatedAt: "2026-06-25T10:00:00.000Z",
        images: [
          {
            imageRef: "ghcr.io/alice/kody-brain-snapshot:20260625",
            createdAt: "2026-06-25T10:00:00.000Z",
            updatedAt: "2026-06-25T10:00:00.000Z",
          },
        ],
      }),
      sha: "sha",
      etag: "etag",
    });
    const { readBrainImage } = await import("@dashboard/lib/brain/store");

    await expect(readBrainImage("Alice", "token")).resolves.toMatchObject({
      imageRef: "ghcr.io/alice/kody-brain-snapshot:20260625",
      images: [
        expect.objectContaining({
          imageRef: "ghcr.io/alice/kody-brain-snapshot:20260625",
        }),
      ],
    });
    expect(state.readStateText).toHaveBeenCalledWith(
      { id: "octokit" },
      "aharonyaircohen",
      "Kody-Dashboard",
      "users/alice/data/brain-image.json",
      expect.objectContaining({ scope: "root" }),
    );
  });

  it("ignores the old repo-scoped Brain image record", async () => {
    state.readStateText.mockResolvedValueOnce(null).mockResolvedValueOnce({
      content: JSON.stringify({
        version: 1,
        imageRef: "ghcr.io/alice/kody-brain-snapshot:20260625",
        createdAt: "2026-06-25T10:00:00.000Z",
        updatedAt: "2026-06-25T10:00:00.000Z",
      }),
      sha: "sha",
    });
    const { readBrainImage } = await import("@dashboard/lib/brain/store");

    await expect(readBrainImage("Alice", "token")).resolves.toBeNull();
    expect(state.readStateText).toHaveBeenNthCalledWith(
      1,
      { id: "octokit" },
      "aharonyaircohen",
      "Kody-Dashboard",
      "users/alice/data/brain-image.json",
      expect.objectContaining({ scope: "root" }),
    );
    expect(state.readStateText).toHaveBeenCalledTimes(1);
  });

  it("reads the stored Brain app from user-level state", async () => {
    state.readStateText.mockResolvedValue({
      content: JSON.stringify({
        version: 1,
        appName: "kody-brain-alice",
        orgSlug: "personal",
        createdAt: "2026-06-25T10:00:00.000Z",
      }),
      sha: "sha",
      etag: "etag",
    });
    const { readBrainApp } = await import("@dashboard/lib/brain/store");

    await expect(readBrainApp("Alice", "token")).resolves.toMatchObject({
      appName: "kody-brain-alice",
    });
    expect(state.readStateText).toHaveBeenCalledWith(
      { id: "octokit" },
      "aharonyaircohen",
      "Kody-Dashboard",
      "users/alice/data/brain.json",
      expect.objectContaining({ scope: "root" }),
    );
  });

  it("writes the stored Brain app to user-level state", async () => {
    state.readStateText.mockResolvedValue(null);
    state.writeStateText.mockResolvedValue({ sha: "new-sha" });
    const { writeBrainApp } = await import("@dashboard/lib/brain/store");

    await writeBrainApp("Alice", "token", {
      version: 1,
      appName: "kody-brain-alice",
      orgSlug: "personal",
      createdAt: "2026-06-25T10:00:00.000Z",
    });

    expect(state.writeStateText).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "users/alice/data/brain.json",
        message: "feat(brain): record brain app for Alice",
        scope: "root",
      }),
    );
  });

  it("clears the user-level Brain app and the old repo-scoped app record", async () => {
    state.readStateText
      .mockResolvedValueOnce({
        sha: "root-sha",
        content: "{}",
      })
      .mockResolvedValueOnce({
        sha: "legacy-sha",
        content: "{}",
      });
    state.deleteStateFile.mockResolvedValue(undefined);
    const { clearBrainApp } = await import("@dashboard/lib/brain/store");

    await clearBrainApp("Alice", "token");

    expect(state.deleteStateFile).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        path: "users/alice/data/brain.json",
        message: "feat(brain): clear brain app for Alice",
        sha: "root-sha",
        scope: "root",
      }),
    );
    expect(state.deleteStateFile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: "users/alice/data/brain.json",
        message: "feat(brain): clear legacy repo brain app for Alice",
        sha: "legacy-sha",
      }),
    );
  });

  it("writes the per-user Brain image record without touching brain.json", async () => {
    state.readStateText.mockResolvedValue(null);
    state.writeStateText.mockResolvedValue({ sha: "new-sha" });
    const { writeBrainImage } = await import("@dashboard/lib/brain/store");

    await writeBrainImage("Alice", "token", {
      version: 1,
      imageRef: "ghcr.io/alice/kody-brain-snapshot:20260625",
      createdAt: "2026-06-25T10:00:00.000Z",
      updatedAt: "2026-06-25T10:00:00.000Z",
      images: [
        {
          imageRef: "ghcr.io/alice/kody-brain-snapshot:20260625",
          createdAt: "2026-06-25T10:00:00.000Z",
          updatedAt: "2026-06-25T10:00:00.000Z",
        },
      ],
    });

    expect(state.writeStateText).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "users/alice/data/brain-image.json",
        message: "feat(brain): record brain image for Alice",
        scope: "root",
      }),
    );
  });

  it("writes catalog-only Brain images without inventing selected or running state", async () => {
    state.readStateText.mockResolvedValue(null);
    state.writeStateText.mockResolvedValue({ sha: "new-sha" });
    const { writeBrainImage } = await import("@dashboard/lib/brain/store");

    await writeBrainImage("Alice", "token", {
      version: 1,
      createdAt: "2026-06-25T10:00:00.000Z",
      updatedAt: "2026-06-25T10:00:00.000Z",
      images: [
        {
          imageRef: "ghcr.io/alice/kody-brain-snapshot:20260625",
          createdAt: "2026-06-25T10:00:00.000Z",
          updatedAt: "2026-06-25T10:00:00.000Z",
        },
      ],
    });

    const content = JSON.parse(
      (state.writeStateText.mock.calls[0]?.[0] as { content: string }).content,
    ) as {
      imageRef?: string;
      runningImageRef?: string;
      runningApp?: string;
      runningMachineId?: string;
    };
    expect(content.imageRef).toBeUndefined();
    expect(content.runningImageRef).toBeUndefined();
    expect(content.runningApp).toBeUndefined();
    expect(content.runningMachineId).toBeUndefined();
  });

  it("selects a saved Brain image without deleting the image list", async () => {
    state.readStateText
      .mockResolvedValueOnce({
        content: JSON.stringify({
          version: 1,
          imageRef: "ghcr.io/alice/kody-brain-snapshot:old",
          createdAt: "2026-06-25T10:00:00.000Z",
          updatedAt: "2026-06-25T10:00:00.000Z",
          images: [
            {
              imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
              createdAt: "2026-06-26T10:00:00.000Z",
              updatedAt: "2026-06-26T10:00:00.000Z",
            },
            {
              imageRef: "ghcr.io/alice/kody-brain-snapshot:old",
              createdAt: "2026-06-25T10:00:00.000Z",
              updatedAt: "2026-06-25T10:00:00.000Z",
            },
          ],
        }),
        sha: "sha",
      })
      .mockResolvedValueOnce({ sha: "sha", content: "{}" });
    state.writeStateText.mockResolvedValue({ sha: "new-sha" });
    const { selectBrainImage } = await import("@dashboard/lib/brain/store");

    await expect(
      selectBrainImage(
        "Alice",
        "token",
        "ghcr.io/alice/kody-brain-snapshot:new",
      ),
    ).resolves.toMatchObject({
      imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
      images: expect.arrayContaining([
        expect.objectContaining({
          imageRef: "ghcr.io/alice/kody-brain-snapshot:old",
        }),
      ]),
    });
  });

  it("refreshes stale image cache before rejecting a selected image", async () => {
    state.readStateText
      .mockResolvedValueOnce({
        content: JSON.stringify({
          version: 1,
          imageRef: "ghcr.io/alice/kody-brain-snapshot:old",
          createdAt: "2026-06-25T10:00:00.000Z",
          updatedAt: "2026-06-25T10:00:00.000Z",
          images: [
            {
              imageRef: "ghcr.io/alice/kody-brain-snapshot:old",
              createdAt: "2026-06-25T10:00:00.000Z",
              updatedAt: "2026-06-25T10:00:00.000Z",
            },
          ],
        }),
        sha: "old-sha",
        etag: "old-etag",
      })
      .mockRejectedValueOnce({ status: 304 })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          version: 1,
          imageRef: "ghcr.io/alice/kody-brain-snapshot:old",
          createdAt: "2026-06-25T10:00:00.000Z",
          updatedAt: "2026-06-26T10:00:00.000Z",
          images: [
            {
              imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
              createdAt: "2026-06-26T10:00:00.000Z",
              updatedAt: "2026-06-26T10:00:00.000Z",
            },
            {
              imageRef: "ghcr.io/alice/kody-brain-snapshot:old",
              createdAt: "2026-06-25T10:00:00.000Z",
              updatedAt: "2026-06-25T10:00:00.000Z",
            },
          ],
        }),
        sha: "new-sha",
        etag: "new-etag",
      })
      .mockResolvedValueOnce({ sha: "new-sha", content: "{}" });
    state.writeStateText.mockResolvedValue({ sha: "written-sha" });
    const { readBrainImage, selectBrainImage } =
      await import("@dashboard/lib/brain/store");

    await readBrainImage("Alice", "token");
    await expect(
      selectBrainImage(
        "Alice",
        "token",
        "ghcr.io/alice/kody-brain-snapshot:new",
      ),
    ).resolves.toMatchObject({
      imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
    });

    expect(state.readStateText).toHaveBeenNthCalledWith(
      3,
      { id: "octokit" },
      "aharonyaircohen",
      "Kody-Dashboard",
      "users/alice/data/brain-image.json",
      { scope: "root", headers: undefined },
    );
  });

  it("forgets a saved Brain image from dashboard metadata", async () => {
    state.readStateText
      .mockResolvedValueOnce({
        content: JSON.stringify({
          version: 1,
          imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
          createdAt: "2026-06-25T10:00:00.000Z",
          updatedAt: "2026-06-26T10:00:00.000Z",
          images: [
            {
              imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
              createdAt: "2026-06-26T10:00:00.000Z",
              updatedAt: "2026-06-26T10:00:00.000Z",
            },
            {
              imageRef: "ghcr.io/alice/kody-brain-snapshot:old",
              createdAt: "2026-06-25T10:00:00.000Z",
              updatedAt: "2026-06-25T10:00:00.000Z",
            },
          ],
        }),
        sha: "sha",
      })
      .mockResolvedValueOnce({ sha: "sha", content: "{}" });
    state.writeStateText.mockResolvedValue({ sha: "new-sha" });
    const { deleteBrainImage } = await import("@dashboard/lib/brain/store");

    await expect(
      deleteBrainImage(
        "Alice",
        "token",
        "ghcr.io/alice/kody-brain-snapshot:old",
      ),
    ).resolves.toMatchObject({
      imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
      images: [
        expect.objectContaining({
          imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
        }),
      ],
      forgottenImageRefs: ["ghcr.io/alice/kody-brain-snapshot:old"],
    });
    const content = JSON.parse(
      (state.writeStateText.mock.calls[0]?.[0] as { content: string }).content,
    ) as { forgottenImageRefs?: string[] };
    expect(content.forgottenImageRefs).toEqual([
      "ghcr.io/alice/kody-brain-snapshot:old",
    ]);
  });

  it("remembers a forgotten discovered Brain image even when it was not saved locally", async () => {
    state.readStateText.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    state.writeStateText.mockResolvedValue({ sha: "new-sha" });
    const { deleteBrainImage } = await import("@dashboard/lib/brain/store");

    await expect(
      deleteBrainImage(
        "Alice",
        "token",
        "ghcr.io/alice/kody-brain-snapshot:discovered",
      ),
    ).resolves.toMatchObject({
      images: [],
      forgottenImageRefs: ["ghcr.io/alice/kody-brain-snapshot:discovered"],
    });

    const content = JSON.parse(
      (state.writeStateText.mock.calls[0]?.[0] as { content: string }).content,
    ) as {
      imageRef?: string;
      images?: unknown[];
      forgottenImageRefs?: string[];
    };
    expect(content.imageRef).toBeUndefined();
    expect(content.images).toEqual([]);
    expect(content.forgottenImageRefs).toEqual([
      "ghcr.io/alice/kody-brain-snapshot:discovered",
    ]);
  });

  it("marks a selected Brain image as running after apply succeeds", async () => {
    state.readStateText
      .mockResolvedValueOnce({
        content: JSON.stringify({
          version: 1,
          imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
          createdAt: "2026-06-25T10:00:00.000Z",
          updatedAt: "2026-06-26T10:00:00.000Z",
          images: [
            {
              imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
              createdAt: "2026-06-26T10:00:00.000Z",
              updatedAt: "2026-06-26T10:00:00.000Z",
            },
          ],
        }),
        sha: "sha",
      })
      .mockResolvedValueOnce({ sha: "sha", content: "{}" });
    state.writeStateText.mockResolvedValue({ sha: "new-sha" });
    const { markBrainImageRunning } =
      await import("@dashboard/lib/brain/store");

    await expect(
      markBrainImageRunning("Alice", "token", {
        imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
        app: "kody-brain-alice",
        machineId: "machine-new",
        runningAt: "2026-07-02T10:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
      runningImageRef: "ghcr.io/alice/kody-brain-snapshot:new",
      runningApp: "kody-brain-alice",
      runningMachineId: "machine-new",
    });

    const content = JSON.parse(
      (state.writeStateText.mock.calls[0]?.[0] as { content: string }).content,
    ) as { runningImageRef?: string; runningMachineId?: string };
    expect(content.runningImageRef).toBe(
      "ghcr.io/alice/kody-brain-snapshot:new",
    );
    expect(content.runningMachineId).toBe("machine-new");
  });

  it("marks an applied saved Brain image as selected and running", async () => {
    state.readStateText
      .mockResolvedValueOnce({
        content: JSON.stringify({
          version: 1,
          imageRef: "ghcr.io/alice/kody-brain-snapshot:old",
          createdAt: "2026-06-25T10:00:00.000Z",
          updatedAt: "2026-06-26T10:00:00.000Z",
          forgottenImageRefs: ["ghcr.io/alice/kody-brain-snapshot:new"],
          images: [
            {
              imageRef: "ghcr.io/alice/kody-brain-snapshot:old",
              createdAt: "2026-06-25T10:00:00.000Z",
              updatedAt: "2026-06-25T10:00:00.000Z",
            },
            {
              imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
              createdAt: "2026-06-26T10:00:00.000Z",
              updatedAt: "2026-06-26T10:00:00.000Z",
            },
          ],
        }),
        sha: "sha",
      })
      .mockResolvedValueOnce({ sha: "sha", content: "{}" });
    state.writeStateText.mockResolvedValue({ sha: "new-sha" });
    const { markBrainImageRunning } =
      await import("@dashboard/lib/brain/store");

    await expect(
      markBrainImageRunning("Alice", "token", {
        imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
        app: "kody-brain-alice",
        machineId: "machine-new",
        runningAt: "2026-07-02T10:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
      runningImageRef: "ghcr.io/alice/kody-brain-snapshot:new",
    });

    const content = JSON.parse(
      (state.writeStateText.mock.calls[0]?.[0] as { content: string }).content,
    ) as {
      imageRef?: string;
      runningImageRef?: string;
      forgottenImageRefs?: string[];
    };
    expect(content.imageRef).toBe("ghcr.io/alice/kody-brain-snapshot:new");
    expect(content.runningImageRef).toBe(
      "ghcr.io/alice/kody-brain-snapshot:new",
    );
    expect(content.forgottenImageRefs).toBeUndefined();
  });

  it("accepts GHCR image refs", async () => {
    const { writeBrainImage } = await import("@dashboard/lib/brain/store");

    state.readStateText.mockResolvedValue(null);
    await expect(
      writeBrainImage("Alice", "token", {
        version: 1,
        imageRef: "ghcr.io/alice/kody-brain-snapshot:20260625",
        createdAt: "2026-06-25T10:00:00.000Z",
        updatedAt: "2026-06-25T10:00:00.000Z",
        images: [
          {
            imageRef: "ghcr.io/alice/kody-brain-snapshot:20260625",
            createdAt: "2026-06-25T10:00:00.000Z",
            updatedAt: "2026-06-25T10:00:00.000Z",
          },
        ],
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects non-GHCR image refs", async () => {
    const { writeBrainImage } = await import("@dashboard/lib/brain/store");

    await expect(
      writeBrainImage("Alice", "token", {
        version: 1,
        imageRef: "docker.io/alice/kody-brain-snapshot:latest",
        createdAt: "2026-06-25T10:00:00.000Z",
        updatedAt: "2026-06-25T10:00:00.000Z",
        images: [],
      }),
    ).rejects.toThrow("Invalid Brain image record");
    await expect(
      writeBrainImage("Alice", "token", {
        version: 1,
        imageRef: "registry.fly.io/kody-brain-alice:20260625",
        createdAt: "2026-06-25T10:00:00.000Z",
        updatedAt: "2026-06-25T10:00:00.000Z",
        images: [],
      }),
    ).rejects.toThrow("Invalid Brain image record");
    expect(state.writeStateText).not.toHaveBeenCalled();
  });

  it("writes and clears an in-progress Brain image save job", async () => {
    state.readStateText.mockResolvedValueOnce(null);
    state.writeStateText.mockResolvedValue({ sha: "job-sha" });
    const { writeBrainImageSave, clearBrainImageSave } =
      await import("@dashboard/lib/brain/store");

    await writeBrainImageSave("Alice", "token", {
      version: 1,
      status: "running",
      phase: "pushing-image",
      message: "Pushing the Brain image to GHCR",
      lastOutput: "layer upload",
      jobId: "0123456789abcdef0123456789abcdef",
      app: "brain-1",
      machineId: "m123",
      bridgeApp: "kody-terminal-personal-abc123",
      orgSlug: "personal",
      defaultRegion: "fra",
      expectedImageRef: "ghcr.io/alice/kody-brain-snapshot:20260625",
      startedAt: "2026-06-25T10:00:00.000Z",
      updatedAt: "2026-06-25T10:00:00.000Z",
    });

    expect(state.writeStateText).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "users/alice/data/brain-image-save.json",
        message: "feat(brain): record brain image save job for Alice",
        scope: "root",
      }),
    );

    state.readStateText.mockResolvedValueOnce({
      sha: "job-sha",
      content: "{}",
    });
    state.deleteStateFile.mockResolvedValueOnce(undefined);
    await clearBrainImageSave("Alice", "token");
    expect(state.deleteStateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "users/alice/data/brain-image-save.json",
        message: "feat(brain): clear brain image save job for Alice",
        scope: "root",
      }),
    );
  });
});
