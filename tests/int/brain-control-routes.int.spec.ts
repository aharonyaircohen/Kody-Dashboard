/**
 * @fileoverview Integration coverage for Brain control routes using stored org.
 * @testFramework vitest
 * @domain brain
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const brainFly = vi.hoisted(() => ({
  destroyBrain: vi.fn(async () => undefined),
  provisionBrain: vi.fn(async () => undefined),
  resumeBrain: vi.fn(async () => undefined),
  suspendBrain: vi.fn(async () => undefined),
  updateBrainSuspension: vi.fn(async () => ({
    app: "brain-1",
    machineId: "machine-runtime",
    suspendOnIdle: false,
  })),
}));

const brainService = vi.hoisted(() => ({
  resolveBrainService: vi.fn(async () => ({
    app: "brain-1",
    orgSlug: "guy-koren",
    defaultRegion: "fra",
    flyToken: "fallback-fly-token",
    stored: {
      version: 1,
      appName: "brain-1",
      orgSlug: "guy-koren",
      createdAt: "2026-06-30T00:00:00.000Z",
    },
    state: "running",
    url: "https://brain-1.fly.dev",
    machineId: "machine-runtime",
  })),
}));

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: vi.fn(async () => null),
}));

vi.mock("@dashboard/lib/runners/fly-context", () => ({
  resolveFlyContext: vi.fn(async () => ({
    ok: true,
    context: {
      owner: "acme",
      repo: "widgets",
      account: "octocat",
      githubToken: "ghp_test",
      flyToken: "fly-token",
      flyOrgSlug: "personal",
      flyDefaultRegion: "fra",
    },
  })),
}));

vi.mock("@dashboard/lib/brain/service-resolver", () => brainService);
vi.mock("@dashboard/lib/brain/store", () => ({
  clearBrainApp: vi.fn(async () => undefined),
}));

vi.mock("@dashboard/lib/runners/brain-fly", () => brainFly);

vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

vi.mock("@dashboard/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

import { POST as destroyPOST } from "../../app/api/kody/brain/destroy/route";
import { POST as resumePOST } from "../../app/api/kody/brain/resume/route";
import { POST as suspendPOST } from "../../app/api/kody/brain/suspend/route";
import { POST as suspensionPOST } from "../../app/api/kody/brain/suspension/route";

function req(path: string): NextRequest {
  return new NextRequest(`https://dash.test${path}`, { method: "POST" });
}

describe("Brain control routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("destroys the stored Brain app in the stored org", async () => {
    const res = await destroyPOST(req("/api/kody/brain/destroy"));

    expect(res.status).toBe(200);
    expect(brainFly.destroyBrain).toHaveBeenCalledWith(
      expect.objectContaining({
        flyToken: "fallback-fly-token",
        appNameOverride: "brain-1",
        orgSlug: "guy-koren",
      }),
    );
  });

  it("resumes the stored Brain app in the stored org", async () => {
    const res = await resumePOST(req("/api/kody/brain/resume"));

    expect(res.status).toBe(200);
    expect(brainFly.resumeBrain).toHaveBeenCalledWith(
      expect.objectContaining({
        flyToken: "fallback-fly-token",
        appNameOverride: "brain-1",
        machineIdOverride: "machine-runtime",
        orgSlug: "guy-koren",
      }),
    );
  });

  it("suspends the stored Brain app in the stored org", async () => {
    const res = await suspendPOST(req("/api/kody/brain/suspend"));

    expect(res.status).toBe(200);
    expect(brainFly.suspendBrain).toHaveBeenCalledWith(
      expect.objectContaining({
        flyToken: "fallback-fly-token",
        appNameOverride: "brain-1",
        machineIdOverride: "machine-runtime",
        orgSlug: "guy-koren",
      }),
    );
  });

  it("updates suspension on the stored Brain machine without provisioning", async () => {
    const res = await suspensionPOST(
      new NextRequest("https://dash.test/api/kody/brain/suspension", {
        method: "POST",
        headers: { "x-kody-brain-suspension": "never" },
      }),
    );

    expect(res.status).toBe(200);
    expect(brainFly.updateBrainSuspension).toHaveBeenCalledWith(
      expect.objectContaining({
        flyToken: "fallback-fly-token",
        appNameOverride: "brain-1",
        machineIdOverride: "machine-runtime",
        orgSlug: "guy-koren",
        suspendOnIdle: false,
      }),
    );
    expect(brainFly.provisionBrain).not.toHaveBeenCalled();
  });
});
