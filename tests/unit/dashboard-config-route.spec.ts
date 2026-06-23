import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    token: "ghp_viewer",
    owner: "acme",
    repo: "widgets",
  })),
  getUserOctokit: vi.fn(async () => ({ marker: "viewer-octokit" })),
  verifyActorLogin: vi.fn(),
}));

const backgroundToken = vi.hoisted(() => ({
  resolveBackgroundToken: vi.fn(
    async (): Promise<{ token: string; source: "app" } | null> => ({
      token: "ghs_app_token",
      source: "app" as const,
    }),
  ),
}));

const githubClient = vi.hoisted(() => ({
  createUserOctokit: vi.fn(() => ({ marker: "app-octokit" })),
}));

const store = vi.hoisted(() => ({
  invalidateDashboardConfigCache: vi.fn(),
  readDashboardConfig: vi.fn(async () => ({
    doc: {
      version: 1,
      defaultPreviewUrl: undefined as string | undefined,
      namedPreviews: [] as Array<{ id: string; label: string; url: string }>,
    },
    sha: "sha-1",
  })),
  writeDashboardConfig: vi.fn(),
}));

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: auth.requireKodyAuth,
  getRequestAuth: auth.getRequestAuth,
  getUserOctokit: auth.getUserOctokit,
  verifyActorLogin: auth.verifyActorLogin,
}));

vi.mock("@dashboard/lib/auth/background-token", () => ({
  resolveBackgroundToken: backgroundToken.resolveBackgroundToken,
}));

vi.mock("@dashboard/lib/github-client", () => ({
  createUserOctokit: githubClient.createUserOctokit,
}));

vi.mock("@dashboard/lib/dashboard-config/store", () => ({
  invalidateDashboardConfigCache: store.invalidateDashboardConfigCache,
  readDashboardConfig: store.readDashboardConfig,
  writeDashboardConfig: store.writeDashboardConfig,
}));

vi.mock("@dashboard/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { GET, PUT } from "../../app/api/kody/dashboard-config/route";

beforeEach(() => {
  vi.clearAllMocks();
  auth.verifyActorLogin.mockResolvedValue({ identity: { login: "alice" } });
});

describe("GET /api/kody/dashboard-config", () => {
  it("reads shared config with the background token when available", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/kody/dashboard-config"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      config: { version: 1, namedPreviews: [] },
    });
    expect(backgroundToken.resolveBackgroundToken).toHaveBeenCalledWith(
      "acme",
      "widgets",
    );
    expect(githubClient.createUserOctokit).toHaveBeenCalledWith(
      "ghs_app_token",
    );
    expect(store.readDashboardConfig).toHaveBeenCalledWith(
      { marker: "app-octokit" },
      "acme",
      "widgets",
    );
    expect(auth.getUserOctokit).not.toHaveBeenCalled();
  });

  it("falls back to the viewer token when no background token is available", async () => {
    backgroundToken.resolveBackgroundToken.mockResolvedValueOnce(null);

    const res = await GET(
      new NextRequest("http://localhost/api/kody/dashboard-config"),
    );

    expect(res.status).toBe(200);
    expect(auth.getUserOctokit).toHaveBeenCalled();
    expect(store.readDashboardConfig).toHaveBeenCalledWith(
      { marker: "viewer-octokit" },
      "acme",
      "widgets",
    );
  });
});

describe("PUT /api/kody/dashboard-config", () => {
  it("preserves an explicit empty preview environment list", async () => {
    store.readDashboardConfig.mockResolvedValueOnce({
      doc: {
        version: 1,
        defaultPreviewUrl: "https://legacy.example.com",
        namedPreviews: [{ id: "prod", label: "Prod", url: "https://prod.dev" }],
      },
      sha: "sha-1",
    });

    const res = await PUT(
      new NextRequest("http://localhost/api/kody/dashboard-config", {
        method: "PUT",
        body: JSON.stringify({
          namedPreviews: [],
          actorLogin: "alice",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(store.writeDashboardConfig).toHaveBeenCalledWith(
      { marker: "viewer-octokit" },
      "acme",
      "widgets",
      {
        version: 1,
        defaultPreviewUrl: "https://legacy.example.com",
        namedPreviews: [],
      },
      "sha-1",
      "chore(dashboard): update preview environments",
    );
  });
});
