/**
 * @fileoverview Unit coverage for explicit Brain image apply.
 * @testFramework vitest
 * @domain brain
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  markBrainImageRunning: vi.fn(),
  readBrainApp: vi.fn(),
  readBrainImage: vi.fn(),
  selectBrainImage: vi.fn(),
  writeBrainApp: vi.fn(),
  writeBrainImage: vi.fn(),
}));

const runtimeManager = vi.hoisted(() => ({
  readBrainRuntimeView: vi.fn(async () => ({
    desiredImageRef: "ghcr.io/acme/kody-brain-octocat:selected",
    source: "runtime",
  })),
  beginBrainRuntimeApply: vi.fn(async () => undefined),
  completeBrainRuntimeApply: vi.fn(
    async (
      _login: string,
      _token: string,
      input: {
        imageRef: string;
        app: string;
        machineId: string;
        orgSlug: string;
        url?: string;
      },
    ) => ({
      version: 1,
      desiredImageRef: input.imageRef,
      running: {
        imageRef: input.imageRef,
        app: input.app,
        machineId: input.machineId,
        orgSlug: input.orgSlug,
        url: input.url,
        appliedAt: "2026-07-02T00:00:00.000Z",
      },
      updatedAt: "2026-07-02T00:00:00.000Z",
    }),
  ),
  failBrainRuntimeApply: vi.fn(async () => undefined),
}));

const runtime = vi.hoisted(() => ({
  brainFlyRuntimeImageRef: vi.fn(
    ({ app, imageRef }: { app: string; imageRef: string }) =>
      `registry.fly.io/${app}:${imageRef.split(":").at(-1)}`,
  ),
  brainGhcrAuth: vi.fn(() => ({ token: "ghcr-token", user: "octocat" })),
  prepareBrainRuntimeImage: vi.fn(async () => undefined),
}));

const brainFly = vi.hoisted(() => ({
  provisionBrain: vi.fn(),
}));

const serviceResolver = vi.hoisted(() => ({
  resolveBrainService: vi.fn(),
}));

const catalog = vi.hoisted(() => ({
  brainImageCatalogFile: vi.fn(
    ({
      previous,
      images,
      updatedAt = "2026-07-05T12:53:01.000Z",
    }: {
      previous: { createdAt?: string; forgottenImageRefs?: string[] } | null;
      images: Array<{ imageRef: string; createdAt: string; updatedAt: string }>;
      updatedAt?: string;
    }) => ({
      version: 1,
      createdAt: previous?.createdAt ?? images[0]?.createdAt ?? updatedAt,
      updatedAt,
      images,
      ...(previous?.forgottenImageRefs?.length
        ? { forgottenImageRefs: previous.forgottenImageRefs }
        : {}),
    }),
  ),
  discoverBrainPackageImages: vi.fn(async () => []),
  mergeBrainSavedImages: vi.fn(
    (
      image: { images?: Array<{ imageRef: string }> } | null,
      discovered: Array<{ imageRef: string }>,
    ) => [...discovered, ...(image?.images ?? [])],
  ),
}));

vi.mock("@dashboard/lib/brain/store", () => store);
vi.mock("@dashboard/lib/brain/runtime-manager", () => runtimeManager);
vi.mock("@dashboard/lib/brain/image-runtime", () => runtime);
vi.mock("@dashboard/lib/brain/image-catalog", () => catalog);
vi.mock("@dashboard/lib/brain/service-resolver", () => serviceResolver);
vi.mock("@dashboard/lib/runners/brain-fly", () => ({
  brainAppName: (account: string) => `kody-brain-${account}`,
  provisionBrain: brainFly.provisionBrain,
}));
vi.mock("@dashboard/lib/logger", () => ({
  logger: { warn: vi.fn() },
}));

import { applySelectedBrainImage } from "../../src/dashboard/lib/brain/image-apply";

describe("applySelectedBrainImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.readBrainApp.mockResolvedValue(null);
    store.readBrainImage.mockResolvedValue({
      version: 1,
      imageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
      images: [
        {
          imageRef: "ghcr.io/acme/kody-brain-octocat:selected",
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
      ],
    });
    brainFly.provisionBrain.mockResolvedValue({
      app: "kody-brain-octocat",
      url: "https://kody-brain-octocat.fly.dev",
      apiKey: "brain-key",
      machineId: "machine-new",
      region: "fra",
      org: "personal",
    });
    serviceResolver.resolveBrainService.mockResolvedValue({
      app: "kody-brain-octocat",
      orgSlug: "personal",
      defaultRegion: "fra",
      flyToken: "fly-token",
      stored: null,
      state: "running",
      url: "https://kody-brain-octocat.fly.dev",
      machineId: "machine-old",
    });
    store.markBrainImageRunning.mockResolvedValue({
      version: 1,
      imageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
      images: [],
    });
    store.selectBrainImage.mockResolvedValue({
      version: 1,
      imageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      runningImageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      runningApp: "kody-brain-octocat",
      runningMachineId: "machine-new",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
      images: [],
    });
    store.writeBrainApp.mockResolvedValue(undefined);
    store.writeBrainImage.mockResolvedValue(undefined);
  });

  it("applies the selected image and records it as running", async () => {
    const result = await applySelectedBrainImage({
      owner: "acme",
      repo: "widgets",
      account: "octocat",
      githubToken: "gh-token",
      allSecrets: {},
      flyToken: "fly-token",
      flyOrgSlug: "personal",
      flyDefaultRegion: "fra",
      dashboardUrl: "https://dash.test",
    });

    expect(brainFly.provisionBrain).toHaveBeenCalledWith(
      expect.objectContaining({
        flyToken: "fly-token",
        account: "octocat",
        appNameOverride: "kody-brain-octocat",
        imageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      }),
    );
    const provisionInput = brainFly.provisionBrain.mock.calls[0]?.[0] as {
      prepareRuntimeImage: (input: {
        app: string;
        sourceImageRef: string;
        runtimeImageRef: string;
      }) => Promise<void>;
    };
    await provisionInput.prepareRuntimeImage({
      app: "kody-brain-octocat",
      sourceImageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      runtimeImageRef: "registry.fly.io/kody-brain-octocat:selected",
    });
    expect(runtime.prepareBrainRuntimeImage).toHaveBeenCalledWith(
      expect.objectContaining({
        imageRef: "ghcr.io/acme/kody-brain-octocat:selected",
        runtimeImageRef: "registry.fly.io/kody-brain-octocat:selected",
        flyToken: "fly-token",
        ghcrToken: "ghcr-token",
      }),
    );
    expect(runtimeManager.beginBrainRuntimeApply).toHaveBeenCalledWith(
      "octocat",
      "gh-token",
      "ghcr.io/acme/kody-brain-octocat:selected",
    );
    expect(store.selectBrainImage).not.toHaveBeenCalled();
    expect(runtimeManager.completeBrainRuntimeApply).toHaveBeenCalledWith(
      "octocat",
      "gh-token",
      expect.objectContaining({
        imageRef: "ghcr.io/acme/kody-brain-octocat:selected",
        app: "kody-brain-octocat",
        machineId: "machine-new",
        orgSlug: "personal",
      }),
    );
    expect(result.runtime.running?.imageRef).toBe(
      "ghcr.io/acme/kody-brain-octocat:selected",
    );
  });

  it("applies an explicitly requested saved image without requiring it to be selected first", async () => {
    store.readBrainImage.mockResolvedValueOnce({
      version: 1,
      imageRef: "ghcr.io/acme/kody-brain-octocat:old",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
      images: [
        {
          imageRef: "ghcr.io/acme/kody-brain-octocat:old",
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
        {
          imageRef: "ghcr.io/acme/kody-brain-octocat:new",
          createdAt: "2026-07-02T01:00:00.000Z",
          updatedAt: "2026-07-02T01:00:00.000Z",
        },
      ],
    });
    store.selectBrainImage.mockResolvedValueOnce({
      version: 1,
      imageRef: "ghcr.io/acme/kody-brain-octocat:new",
      runningImageRef: "ghcr.io/acme/kody-brain-octocat:new",
      runningApp: "kody-brain-octocat",
      runningMachineId: "machine-new",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T01:00:00.000Z",
      images: [],
    });

    const result = await applySelectedBrainImage({
      owner: "acme",
      repo: "widgets",
      account: "octocat",
      githubToken: "gh-token",
      allSecrets: {},
      flyToken: "fly-token",
      flyOrgSlug: "personal",
      flyDefaultRegion: "fra",
      dashboardUrl: "https://dash.test",
      imageRef: "ghcr.io/acme/kody-brain-octocat:new",
    });

    expect(brainFly.provisionBrain).toHaveBeenCalledWith(
      expect.objectContaining({
        imageRef: "ghcr.io/acme/kody-brain-octocat:new",
      }),
    );
    expect(result.runtime.running?.imageRef).toBe(
      "ghcr.io/acme/kody-brain-octocat:new",
    );
    expect(store.selectBrainImage).not.toHaveBeenCalled();
  });

  it("applies a recently discovered GHCR image when the saved image record is stale", async () => {
    store.readBrainImage.mockResolvedValueOnce({
      version: 1,
      imageRef: "ghcr.io/acme/kody-brain-octocat:old",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
      images: [
        {
          imageRef: "ghcr.io/acme/kody-brain-octocat:old",
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
      ],
    });
    catalog.discoverBrainPackageImages.mockResolvedValueOnce([
      {
        imageRef: "ghcr.io/acme/kody-brain-octocat:new",
        createdAt: "2026-07-05T12:53:01.000Z",
        updatedAt: "2026-07-05T12:53:01.000Z",
      },
    ] as never);
    store.selectBrainImage.mockResolvedValueOnce({
      version: 1,
      imageRef: "ghcr.io/acme/kody-brain-octocat:new",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-05T12:53:01.000Z",
      images: [
        {
          imageRef: "ghcr.io/acme/kody-brain-octocat:new",
          createdAt: "2026-07-05T12:53:01.000Z",
          updatedAt: "2026-07-05T12:53:01.000Z",
        },
      ],
    });

    await applySelectedBrainImage({
      owner: "acme",
      repo: "widgets",
      account: "octocat",
      githubToken: "gh-token",
      allSecrets: {},
      flyToken: "fly-token",
      flyOrgSlug: "personal",
      flyDefaultRegion: "fra",
      dashboardUrl: "https://dash.test",
      imageRef: "ghcr.io/acme/kody-brain-octocat:new",
    });

    expect(catalog.discoverBrainPackageImages).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "widgets",
        account: "octocat",
        githubToken: "ghcr-token",
      }),
    );
    expect(store.writeBrainImage).toHaveBeenCalledWith(
      "octocat",
      "gh-token",
      expect.objectContaining({
        images: expect.arrayContaining([
          expect.objectContaining({
            imageRef: "ghcr.io/acme/kody-brain-octocat:new",
          }),
        ]),
      }),
    );
    expect(store.writeBrainImage.mock.calls[0]?.[2]).not.toHaveProperty(
      "imageRef",
      "ghcr.io/acme/kody-brain-octocat:new",
    );
    expect(store.selectBrainImage).not.toHaveBeenCalled();
    expect(brainFly.provisionBrain).toHaveBeenCalledWith(
      expect.objectContaining({
        imageRef: "ghcr.io/acme/kody-brain-octocat:new",
      }),
    );
  });

  it("uses the resolver-selected Fly token for stored Brain operations", async () => {
    serviceResolver.resolveBrainService.mockResolvedValueOnce({
      app: "custom-brain",
      orgSlug: "other-org",
      defaultRegion: "fra",
      flyToken: "fallback-fly-token",
      stored: {
        version: 1,
        appName: "custom-brain",
        orgSlug: "other-org",
        createdAt: "2026-07-02T00:00:00.000Z",
      },
      state: "suspended",
      url: "https://custom-brain.fly.dev",
      machineId: "machine-old",
    });

    await applySelectedBrainImage({
      owner: "acme",
      repo: "widgets",
      account: "octocat",
      githubToken: "gh-token",
      allSecrets: {},
      flyToken: "vault-fly-token",
      flyOrgSlug: "personal",
      flyDefaultRegion: "fra",
      dashboardUrl: "https://dash.test",
    });

    expect(brainFly.provisionBrain).toHaveBeenCalledWith(
      expect.objectContaining({
        flyToken: "fallback-fly-token",
        appNameOverride: "custom-brain",
        orgSlug: "other-org",
      }),
    );
  });

  it("uses runtime desired image when the catalog has no legacy selected image", async () => {
    store.readBrainImage.mockResolvedValueOnce({
      version: 1,
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
      images: [
        {
          imageRef: "ghcr.io/acme/kody-brain-octocat:selected",
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
      ],
    });

    await applySelectedBrainImage({
      owner: "acme",
      repo: "widgets",
      account: "octocat",
      githubToken: "gh-token",
      allSecrets: {},
      flyToken: "fly-token",
      flyOrgSlug: "personal",
      flyDefaultRegion: "fra",
      dashboardUrl: "https://dash.test",
    });

    expect(runtimeManager.readBrainRuntimeView).toHaveBeenCalledWith(
      "octocat",
      "gh-token",
    );
    expect(brainFly.provisionBrain).toHaveBeenCalledWith(
      expect.objectContaining({
        imageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      }),
    );
    expect(store.selectBrainImage).not.toHaveBeenCalled();
  });

  it("fails the apply operation when the Brain app record cannot be saved", async () => {
    store.writeBrainApp.mockRejectedValueOnce(new Error("state repo down"));

    await expect(
      applySelectedBrainImage({
        owner: "acme",
        repo: "widgets",
        account: "octocat",
        githubToken: "gh-token",
        allSecrets: {},
        flyToken: "fly-token",
        flyOrgSlug: "personal",
        flyDefaultRegion: "fra",
        dashboardUrl: "https://dash.test",
      }),
    ).rejects.toThrow("state repo down");

    expect(runtimeManager.failBrainRuntimeApply).toHaveBeenCalledWith(
      "octocat",
      "gh-token",
      "ghcr.io/acme/kody-brain-octocat:selected",
      "state repo down",
    );
  });
});
