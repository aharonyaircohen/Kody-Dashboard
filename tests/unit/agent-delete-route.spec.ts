/**
 * @fileoverview Unit tests for deleting/removing agent entries.
 * @testFramework vitest
 * @domain agents
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
  readAgentFile: vi.fn(),
  readResolvedAgentFile: vi.fn(),
  writeAgentFile: vi.fn(),
  deleteAgentFile: vi.fn(),
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

vi.mock("@dashboard/lib/agent-files", () => ({
  readAgentFile: h.readAgentFile,
  readResolvedAgentFile: h.readResolvedAgentFile,
  writeAgentFile: h.writeAgentFile,
  deleteAgentFile: h.deleteAgentFile,
  isValidSlug: (slug: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug),
}));

vi.mock("@dashboard/lib/engine/config", () => ({
  getEngineConfig: h.getEngineConfig,
  writeConfigPatch: h.writeConfigPatch,
}));

vi.mock("@dashboard/lib/activity/audit", () => ({
  recordAudit: h.recordAudit,
}));

import { DELETE } from "../../app/api/kody/agents/[slug]/route";

function deleteRequest(slug = "release-manager") {
  return new NextRequest(
    `https://dash.test/api/kody/agents/${slug}?actorLogin=alice`,
    {
      method: "DELETE",
      headers: {
        "x-kody-token": "ghp_test-token",
        "x-kody-owner": "acme",
        "x-kody-repo": "widgets",
      },
    },
  );
}

function params(slug = "release-manager") {
  return { params: Promise.resolve({ slug }) };
}

describe("DELETE /api/kody/agents/[slug]", () => {
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
      config: { company: { activeAgents: [] } },
      sha: "config-sha",
    });
    h.writeConfigPatch.mockResolvedValue({ sha: "next-sha" });
  });

  it("removes an active Store agent reference when no local file exists", async () => {
    const octokit = { rest: {} };
    h.getUserOctokit.mockResolvedValue(octokit);
    h.readAgentFile.mockResolvedValue(null);
    h.getEngineConfig.mockResolvedValue({
      config: {
        company: {
          activeAgents: ["release-manager", "qa"],
        },
      },
      sha: "config-sha",
    });

    const res = await DELETE(deleteRequest(), params());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      removedStoreReference: true,
    });
    expect(h.deleteAgentFile).not.toHaveBeenCalled();
    expect(h.writeConfigPatch).toHaveBeenCalledWith(
      octokit,
      "acme",
      "widgets",
      { activeAgents: ["qa"] },
      "chore(kody): remove store agent release-manager",
    );
    expect(h.recordAudit).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        action: "agent.removeStoreReference",
        resource: "release-manager",
      }),
    );
  });

  it("clears active Store agents when the last reference is removed", async () => {
    h.readAgentFile.mockResolvedValue(null);
    h.getEngineConfig.mockResolvedValue({
      config: {
        company: {
          activeAgents: ["release-manager"],
        },
      },
      sha: "config-sha",
    });

    const res = await DELETE(deleteRequest(), params());

    expect(res.status).toBe(200);
    expect(h.writeConfigPatch).toHaveBeenCalledWith(
      { rest: {} },
      "acme",
      "widgets",
      { activeAgents: null },
      "chore(kody): remove store agent release-manager",
    );
  });

  it("keeps local file deletion for local agents", async () => {
    const octokit = { rest: {} };
    h.getUserOctokit.mockResolvedValue(octokit);
    h.readAgentFile.mockResolvedValue({
      slug: "release-manager",
      title: "Release Manager",
      body: "Prepare releases.",
    });

    const res = await DELETE(deleteRequest(), params());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(h.deleteAgentFile).toHaveBeenCalledWith(octokit, "release-manager");
    expect(h.writeConfigPatch).not.toHaveBeenCalled();
    expect(h.recordAudit).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        action: "agent.delete",
        resource: "release-manager",
      }),
    );
  });
});
