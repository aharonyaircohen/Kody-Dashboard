/**
 * @fileoverview Unit coverage for Brain service resolution.
 * @testFramework vitest
 * @domain brain
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const store = vi.hoisted(() => ({
  readBrainApp: vi.fn(),
}));

const runtimeManager = vi.hoisted(() => ({
  readBrainRuntimeView: vi.fn(),
}));

const target = vi.hoisted(() => ({
  resolveBrainTarget: vi.fn(),
}));

const flyPreviews = vi.hoisted(() => ({
  listMachines: vi.fn(),
}));

const brainFly = vi.hoisted(() => ({
  brainStatus: vi.fn(),
}));

vi.mock("@dashboard/lib/brain/store", () => store);
vi.mock("@dashboard/lib/brain/runtime-manager", () => runtimeManager);
vi.mock("@dashboard/lib/brain/target", () => target);
vi.mock("@dashboard/lib/previews/fly-previews", () => flyPreviews);
vi.mock("@dashboard/lib/runners/brain-fly", () => brainFly);

describe("resolveBrainService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.readBrainApp.mockResolvedValue({
      app: "brain-1",
      orgSlug: "personal",
    });
    runtimeManager.readBrainRuntimeView.mockResolvedValue({ source: "empty" });
    target.resolveBrainTarget.mockReturnValue({
      app: "brain-1",
      orgSlug: "personal",
    });
    brainFly.brainStatus.mockResolvedValue({
      app: "brain-1",
      state: "running",
      url: "https://brain-1.fly.dev",
      machineId: "m-old",
      org: "personal",
    });
    flyPreviews.listMachines.mockResolvedValue([
      {
        id: "m-old",
        state: "started",
        region: "fra",
        createdAt: "2026-07-02T09:00:00.000Z",
      },
      {
        id: "m-runtime",
        state: "suspended",
        region: "fra",
        createdAt: "2026-07-02T10:00:00.000Z",
      },
    ]);
  });

  it("uses the runtime machine id when resolving the active Brain machine", async () => {
    runtimeManager.readBrainRuntimeView.mockResolvedValueOnce({
      source: "runtime",
      runningApp: "brain-1",
      runningMachineId: "m-runtime",
      runningOrgSlug: "personal",
      runningUrl: "https://brain-1.fly.dev",
    });
    const { resolveBrainService } = await import(
      "@dashboard/lib/brain/service-resolver"
    );

    const resolved = await resolveBrainService({
      flyToken: "fly-token",
      account: "octocat",
      githubToken: "github-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    });

    expect(brainFly.brainStatus).toHaveBeenCalledWith(
      expect.objectContaining({ machineIdOverride: "m-runtime" }),
    );
    expect(resolved.machineId).toBe("m-runtime");
    expect(resolved.machine?.machineId).toBe("m-runtime");
  });

  it("does not let stale runtime app state replace the stored Brain app", async () => {
    runtimeManager.readBrainRuntimeView.mockResolvedValueOnce({
      source: "runtime",
      runningApp: "old-brain",
      runningMachineId: "m-runtime",
      runningOrgSlug: "old-org",
      runningUrl: "https://old-brain.fly.dev",
    });
    const { resolveBrainService } = await import(
      "@dashboard/lib/brain/service-resolver"
    );

    const resolved = await resolveBrainService({
      flyToken: "fly-token",
      account: "octocat",
      githubToken: "github-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    });

    expect(brainFly.brainStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        appNameOverride: "brain-1",
        machineIdOverride: undefined,
        orgSlug: "personal",
      }),
    );
    expect(flyPreviews.listMachines).toHaveBeenCalledWith(
      "brain-1",
      expect.objectContaining({ orgSlug: "personal" }),
    );
    expect(resolved.app).toBe("brain-1");
  });

  it("does not silently fall back when the runtime machine is missing", async () => {
    runtimeManager.readBrainRuntimeView.mockResolvedValueOnce({
      source: "runtime",
      runningApp: "brain-1",
      runningMachineId: "m-missing",
      runningOrgSlug: "personal",
      runningUrl: "https://brain-1.fly.dev",
    });
    const { resolveBrainService } = await import(
      "@dashboard/lib/brain/service-resolver"
    );

    const resolved = await resolveBrainService({
      flyToken: "fly-token",
      account: "octocat",
      githubToken: "github-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    });

    expect(resolved.machine).toBeUndefined();
    expect(resolved.machineId).toBe("m-missing");
    expect(resolved.reason).toBe("runtime_machine_not_found");
  });
});
