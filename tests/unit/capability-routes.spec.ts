/**
 * @fileoverview Unit tests for capability API routes.
 * @testFramework vitest
 * @domain capabilities
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(),
  verifyActorLogin: vi.fn(),
  getUserOctokit: vi.fn(),
  getRequestAuth: vi.fn(),
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
  listCapabilityFiles: vi.fn(),
  readCapabilityFile: vi.fn(),
  readResolvedCapabilityFile: vi.fn(),
  writeCapabilityFile: vi.fn(),
  deleteCapabilityFile: vi.fn(),
  getEngineConfig: vi.fn(),
  writeConfigPatch: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: h.requireKodyAuth,
  verifyActorLogin: h.verifyActorLogin,
  getUserOctokit: h.getUserOctokit,
  getRequestAuth: h.getRequestAuth,
}));

vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: h.setGitHubContext,
  clearGitHubContext: h.clearGitHubContext,
}));

vi.mock("@dashboard/lib/capabilities", () => ({
  listCapabilityFiles: h.listCapabilityFiles,
  readCapabilityFile: h.readCapabilityFile,
  readResolvedCapabilityFile: h.readResolvedCapabilityFile,
  writeCapabilityFile: h.writeCapabilityFile,
  deleteCapabilityFile: h.deleteCapabilityFile,
  isValidSlug: (slug: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug),
  PERMISSION_MODES: ["default", "acceptEdits", "plan", "bypassPermissions"],
  CAPABILITY_KINDS: ["observe", "act", "verify"],
}));

vi.mock("@dashboard/lib/engine/config", () => ({
  getEngineConfig: h.getEngineConfig,
  writeConfigPatch: h.writeConfigPatch,
}));

vi.mock("@dashboard/lib/activity/audit", () => ({
  recordAudit: h.recordAudit,
}));

import { GET, POST } from "../../app/api/kody/capabilities/route";
import { DELETE } from "../../app/api/kody/capabilities/[slug]/route";

function authHeaders() {
  return {
    "x-kody-token": "ghp_test-token",
    "x-kody-owner": "acme",
    "x-kody-repo": "widgets",
  };
}

function request(
  url: string,
  init: { method?: string; body?: BodyInit | null; headers?: HeadersInit } = {},
) {
  return new NextRequest(url, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
  });
}

function params(slug = "ship-feature") {
  return { params: Promise.resolve({ slug }) };
}

describe("GET /api/kody/capabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.requireKodyAuth.mockResolvedValue(null);
    h.verifyActorLogin.mockResolvedValue({ identity: { login: "alice" } });
    h.getRequestAuth.mockReturnValue({
      token: "ghp_test-token",
      owner: "acme",
      repo: "widgets",
      storeRepoUrl: "https://github.com/acme/kody-store",
      storeRef: "stable",
    });
    h.getUserOctokit.mockResolvedValue({ rest: {} });
    h.getEngineConfig.mockResolvedValue({
      config: {
        company: {
          activeCapabilities: ["store-on"],
        },
      },
      sha: "config-sha",
    });
  });

  it("lists local capabilities and active Store capabilities only", async () => {
    h.listCapabilityFiles.mockResolvedValue([
      { slug: "local-one", source: "local" },
      { slug: "store-on", source: "store" },
      { slug: "store-off", source: "store" },
    ]);

    const res = await GET(request("https://dash.test/api/kody/capabilities"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.capabilities.map((entry: { slug: string }) => entry.slug)).toEqual([
      "local-one",
      "store-on",
    ]);
    expect(json.executables).toBeUndefined();
    expect(h.listCapabilityFiles).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/kody/capabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.requireKodyAuth.mockResolvedValue(null);
    h.verifyActorLogin.mockResolvedValue({ identity: { login: "alice" } });
    h.getRequestAuth.mockReturnValue({
      token: "ghp_test-token",
      owner: "acme",
      repo: "widgets",
      storeRepoUrl: "https://github.com/acme/kody-store",
      storeRef: "stable",
    });
    h.getUserOctokit.mockResolvedValue({ rest: {} });
    h.readCapabilityFile.mockResolvedValue(null);
    h.writeCapabilityFile.mockResolvedValue({
      slug: "ship-feature",
      describe: "Ship feature",
      capabilityKind: "act",
    });
  });

  it("creates capability files through the capability storage helper", async () => {
    const res = await POST(
      request("https://dash.test/api/kody/capabilities", {
        method: "POST",
        body: JSON.stringify({
          slug: "ship-feature",
          instructions: "Ship the feature.",
          capabilityKind: "act",
          tools: ["Read"],
          skills: [],
          shellScripts: [],
          mcpServers: [],
        }),
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ capability: { slug: "ship-feature" } });
    expect(json).not.toHaveProperty("executable");
    expect(h.writeCapabilityFile).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.objectContaining({
          slug: "ship-feature",
          prompt: "Ship the feature.",
          capabilityKind: "act",
        }),
      }),
    );
    expect(h.recordAudit).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        action: "capability.create",
        resource: "ship-feature",
      }),
    );
  });
});

describe("DELETE /api/kody/capabilities/[slug]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.requireKodyAuth.mockResolvedValue(null);
    h.verifyActorLogin.mockResolvedValue({ identity: { login: "alice" } });
    h.getRequestAuth.mockReturnValue({
      token: "ghp_test-token",
      owner: "acme",
      repo: "widgets",
      storeRepoUrl: "https://github.com/acme/kody-store",
      storeRef: "stable",
    });
    h.getUserOctokit.mockResolvedValue({ rest: {} });
  });

  it("deletes local capability folders through the capability helper", async () => {
    const octokit = { rest: {} };
    h.getUserOctokit.mockResolvedValue(octokit);
    h.readCapabilityFile.mockResolvedValue({
      slug: "ship-feature",
      describe: "Ship feature",
    });

    const res = await DELETE(
      request(
        "https://dash.test/api/kody/capabilities/ship-feature?actorLogin=alice",
        { method: "DELETE" },
      ),
      params(),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(h.deleteCapabilityFile).toHaveBeenCalledWith(
      octokit,
      "ship-feature",
    );
    expect(h.writeConfigPatch).not.toHaveBeenCalled();
    expect(h.recordAudit).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        action: "capability.delete",
        resource: "ship-feature",
      }),
    );
  });
});
