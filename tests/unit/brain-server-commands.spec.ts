/**
 * @fileoverview Unit coverage for Brain lifecycle command persistence.
 * @testFramework vitest
 * @domain brain
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FlyContext } from "@dashboard/lib/runners/fly-context";

const store = vi.hoisted(() => ({
  clearBrainApp: vi.fn(async () => undefined),
  readBrainApp: vi.fn(async () => null),
  writeBrainApp: vi.fn(async () => undefined),
}));

const brainFly = vi.hoisted(() => ({
  destroyBrain: vi.fn(async () => undefined),
  isBrainFlyProvisionTransientError: vi.fn(() => false),
  provisionBrain: vi.fn(async () => ({
    app: "kody-brain-octocat",
    url: "https://kody-brain-octocat.fly.dev",
    apiKey: "brain-key",
    machineId: "machine-1",
    region: "fra",
    org: "personal",
  })),
  resumeBrain: vi.fn(async () => undefined),
  suspendBrain: vi.fn(async () => undefined),
  updateBrainSuspension: vi.fn(async () => ({
    app: "kody-brain-octocat",
    machineId: "machine-1",
    suspendOnIdle: true,
  })),
}));

vi.mock("@dashboard/lib/brain/store", () => store);
vi.mock("@dashboard/lib/runners/brain-fly", () => ({
  ...brainFly,
  brainAppName: (account: string) => `kody-brain-${account}`,
}));
vi.mock("@dashboard/lib/brain/service-resolver", () => ({
  resolveBrainService: vi.fn(async () => ({
    app: "kody-brain-octocat",
    orgSlug: "personal",
    defaultRegion: "fra",
    flyToken: "fly-token",
    stored: null,
    state: "running",
    url: "https://kody-brain-octocat.fly.dev",
    machineId: "machine-1",
  })),
}));
vi.mock("@dashboard/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

import { manageBrainServer } from "../../src/dashboard/lib/brain/server-commands";

const context: FlyContext = {
  owner: "acme",
  repo: "widgets",
  account: "octocat",
  engineModel: undefined,
  engineModelConfig: undefined,
  githubToken: "gh-token",
  octokit: {} as FlyContext["octokit"],
  flyToken: "fly-token",
  flyOrgSlug: "personal",
  flyDefaultRegion: "fra",
  allSecrets: {},
  perfTier: undefined,
};

describe("manageBrainServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clearBrainApp.mockResolvedValue(undefined);
    store.readBrainApp.mockResolvedValue(null);
    store.writeBrainApp.mockResolvedValue(undefined);
  });

  it("does not report provision success when the Brain app record cannot be saved", async () => {
    store.writeBrainApp.mockRejectedValueOnce(new Error("state repo down"));

    await expect(
      manageBrainServer({ command: "provision", context }),
    ).rejects.toThrow("state repo down");

    expect(brainFly.provisionBrain).toHaveBeenCalled();
    expect(store.writeBrainApp).toHaveBeenCalled();
  });

  it("does not report destroy success when the stored Brain record cannot be cleared", async () => {
    store.clearBrainApp.mockRejectedValueOnce(new Error("state repo down"));

    await expect(
      manageBrainServer({ command: "destroy", context }),
    ).rejects.toThrow("state repo down");

    expect(brainFly.destroyBrain).toHaveBeenCalled();
    expect(store.clearBrainApp).toHaveBeenCalled();
  });
});
