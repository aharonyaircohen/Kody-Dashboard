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
vi.mock(
  "@dashboard/lib/infrastructure/plugins/fly/previews/machines-client",
  () => flyPreviews,
);
vi.mock(
  "@dashboard/lib/infrastructure/plugins/fly/runners/brain",
  () => brainFly,
);

describe("resolveBrainService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FLY_API_TOKEN;
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
    const { resolveBrainService } =
      await import("@dashboard/lib/brain/service-resolver");

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
    const { resolveBrainService } =
      await import("@dashboard/lib/brain/service-resolver");

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
    const { resolveBrainService } =
      await import("@dashboard/lib/brain/service-resolver");

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

  it("uses the environment Fly token when the stored Brain is only visible there", async () => {
    process.env.FLY_API_TOKEN = "fallback-token";
    brainFly.brainStatus
      .mockResolvedValueOnce({
        app: "brain-1",
        state: "off",
        org: "personal",
      })
      .mockResolvedValueOnce({
        app: "brain-1",
        state: "running",
        url: "https://brain-1.fly.dev",
        machineId: "m-fallback",
        org: "personal",
      });
    flyPreviews.listMachines
      .mockRejectedValueOnce(new Error("not visible"))
      .mockResolvedValueOnce([
        {
          id: "m-fallback",
          state: "started",
          region: "fra",
          createdAt: "2026-07-02T10:00:00.000Z",
        },
      ]);
    const { resolveBrainService } =
      await import("@dashboard/lib/brain/service-resolver");

    const resolved = await resolveBrainService({
      flyToken: "vault-token",
      account: "octocat",
      githubToken: "github-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    });

    expect(resolved.flyToken).toBe("fallback-token");
    expect(resolved.machineId).toBe("m-fallback");
    delete process.env.FLY_API_TOKEN;
  });

  it("prefers the environment Fly token when it resolves the same Brain machine", async () => {
    process.env.FLY_API_TOKEN = "fallback-token";
    brainFly.brainStatus
      .mockResolvedValueOnce({
        app: "brain-1",
        state: "running",
        url: "https://brain-1.fly.dev",
        machineId: "m-old",
        org: "personal",
      })
      .mockResolvedValueOnce({
        app: "brain-1",
        state: "running",
        url: "https://brain-1.fly.dev",
        machineId: "m-old",
        org: "personal",
      });
    flyPreviews.listMachines
      .mockResolvedValueOnce([
        {
          id: "m-old",
          state: "started",
          region: "fra",
          createdAt: "2026-07-02T10:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "m-old",
          state: "started",
          region: "fra",
          createdAt: "2026-07-02T10:00:00.000Z",
        },
      ]);
    const { resolveBrainService } =
      await import("@dashboard/lib/brain/service-resolver");

    const resolved = await resolveBrainService({
      flyToken: "vault-token",
      account: "octocat",
      githubToken: "github-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    });

    expect(resolved.flyToken).toBe("fallback-token");
    expect(resolved.machineId).toBe("m-old");
    delete process.env.FLY_API_TOKEN;
  });

  it("uses the environment Fly token for runtime-only Brain records", async () => {
    process.env.FLY_API_TOKEN = "fallback-token";
    store.readBrainApp.mockResolvedValueOnce(null);
    runtimeManager.readBrainRuntimeView.mockResolvedValueOnce({
      source: "runtime",
      runningApp: "brain-1",
      runningMachineId: "m-runtime",
      runningOrgSlug: "personal",
    });
    brainFly.brainStatus
      .mockResolvedValueOnce({
        app: "brain-1",
        state: "off",
        org: "personal",
      })
      .mockResolvedValueOnce({
        app: "brain-1",
        state: "running",
        url: "https://brain-1.fly.dev",
        machineId: "m-runtime",
        org: "personal",
      });
    flyPreviews.listMachines
      .mockRejectedValueOnce(new Error("not visible"))
      .mockResolvedValueOnce([
        {
          id: "m-runtime",
          state: "started",
          region: "fra",
          createdAt: "2026-07-02T10:00:00.000Z",
        },
      ]);
    const { resolveBrainService } =
      await import("@dashboard/lib/brain/service-resolver");

    const resolved = await resolveBrainService({
      flyToken: "vault-token",
      account: "octocat",
      githubToken: "github-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    });

    expect(resolved.flyToken).toBe("fallback-token");
    expect(resolved.machineId).toBe("m-runtime");
    delete process.env.FLY_API_TOKEN;
  });

  it("keeps Fly authorization failures separate from missing apps", async () => {
    brainFly.brainStatus.mockResolvedValueOnce({
      app: "brain-1",
      state: "off",
      org: "personal",
      accessDenied: true,
    });
    flyPreviews.listMachines.mockRejectedValueOnce(
      Object.assign(new Error("unauthorized"), { status: 403 }),
    );
    const { resolveBrainService } =
      await import("@dashboard/lib/brain/service-resolver");

    const resolved = await resolveBrainService({
      flyToken: "vault-token",
      account: "octocat",
      githubToken: "github-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    });

    expect(resolved.reason).toBe("fly_access_denied");
    expect(resolved.state).toBe("off");
    expect(resolved.stored).toBeTruthy();
  });
});
