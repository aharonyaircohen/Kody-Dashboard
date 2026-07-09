/**
 * @fileoverview Unit coverage for Brain runtime state boundaries.
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
}));

vi.mock("@dashboard/lib/github-client", () => ({
  getOctokit: state.getOctokit,
  getOwner: state.getOwner,
  getRepo: state.getRepo,
}));

vi.mock("@dashboard/lib/state-repo", () => ({
  readStateText: state.readStateText,
  writeStateText: state.writeStateText,
}));

describe("Brain runtime store", () => {
  beforeEach(() => {
    vi.resetModules();
    state.getOctokit.mockReturnValue({ id: "octokit" });
    state.getOwner.mockReturnValue("aharonyaircohen");
    state.getRepo.mockReturnValue("Kody-Dashboard");
    state.readStateText.mockReset();
    state.writeStateText.mockReset();
  });

  it("writes runtime state to brain-runtime.json, not the image catalog", async () => {
    state.readStateText.mockResolvedValue(null);
    state.writeStateText.mockResolvedValue({ sha: "new-sha" });
    const { writeBrainRuntimeState } =
      await import("@dashboard/lib/brain/runtime-store");

    await writeBrainRuntimeState("Alice", "token", {
      version: 1,
      desiredImageRef: "ghcr.io/alice/kody-brain-snapshot:new",
      running: {
        imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
        app: "brain-1",
        machineId: "machine-1",
        orgSlug: "personal",
        appliedAt: "2026-07-02T10:00:00.000Z",
      },
      updatedAt: "2026-07-02T10:00:00.000Z",
    });

    expect(state.writeStateText).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "users/alice/data/brain-runtime.json",
        message: "feat(brain): record brain runtime for Alice",
        scope: "root",
      }),
    );
  });

  it("rejects invalid runtime image refs", async () => {
    const { writeBrainRuntimeState } =
      await import("@dashboard/lib/brain/runtime-store");

    await expect(
      writeBrainRuntimeState("Alice", "token", {
        version: 1,
        desiredImageRef: "registry.fly.io/brain-1:new",
        updatedAt: "2026-07-02T10:00:00.000Z",
      }),
    ).rejects.toThrow("Invalid Brain runtime state");
    expect(state.writeStateText).not.toHaveBeenCalled();
  });

  it("rejects completed apply state without a recorded running machine", async () => {
    const { writeBrainRuntimeState } =
      await import("@dashboard/lib/brain/runtime-store");

    await expect(
      writeBrainRuntimeState("Alice", "token", {
        version: 1,
        desiredImageRef: "ghcr.io/alice/kody-brain-snapshot:new",
        operation: {
          id: "op-1",
          type: "apply-image",
          status: "completed",
          imageRef: "ghcr.io/alice/kody-brain-snapshot:new",
          startedAt: "2026-07-02T10:00:00.000Z",
          updatedAt: "2026-07-02T10:01:00.000Z",
        },
        updatedAt: "2026-07-02T10:01:00.000Z",
      }),
    ).rejects.toThrow("Invalid Brain runtime state");
    expect(state.writeStateText).not.toHaveBeenCalled();
  });
});
