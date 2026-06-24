/**
 * @fileoverview Unit tests for deleting/removing agentResponsibility entries.
 * @testFramework vitest
 * @domain agent-responsibilities
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
  readAgentResponsibilityFile: vi.fn(),
  readResolvedAgentResponsibilityFile: vi.fn(),
  writeAgentResponsibilityFile: vi.fn(),
  deleteAgentResponsibilityFile: vi.fn(),
  readAgentFile: vi.fn(),
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

vi.mock("@dashboard/lib/agent-responsibilities-files", () => ({
  readAgentResponsibilityFile: h.readAgentResponsibilityFile,
  readResolvedAgentResponsibilityFile: h.readResolvedAgentResponsibilityFile,
  writeAgentResponsibilityFile: h.writeAgentResponsibilityFile,
  deleteAgentResponsibilityFile: h.deleteAgentResponsibilityFile,
  isValidSlug: (slug: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug),
}));

vi.mock("@dashboard/lib/agent-files", () => ({
  readAgentFile: h.readAgentFile,
}));

vi.mock("@dashboard/lib/engine/config", () => ({
  getEngineConfig: h.getEngineConfig,
  writeConfigPatch: h.writeConfigPatch,
}));

vi.mock("@dashboard/lib/activity/audit", () => ({
  recordAudit: h.recordAudit,
}));

import { DELETE } from "../../app/api/kody/agent-responsibilities/[slug]/route";

function deleteRequest(slug = "release-watch") {
  return new NextRequest(
    `https://dash.test/api/kody/agent-responsibilities/${slug}?actorLogin=alice`,
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

function params(slug = "release-watch") {
  return { params: Promise.resolve({ slug }) };
}

describe("DELETE /api/kody/agent-responsibilities/[slug]", () => {
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
      config: { company: { activeAgentResponsibilities: [] } },
      sha: "config-sha",
    });
    h.writeConfigPatch.mockResolvedValue({ sha: "next-sha" });
  });

  it("removes an active Store agentResponsibility reference when no local folder exists", async () => {
    const octokit = { rest: {} };
    h.getUserOctokit.mockResolvedValue(octokit);
    h.readAgentResponsibilityFile.mockResolvedValue(null);
    h.getEngineConfig.mockResolvedValue({
      config: {
        company: {
          activeAgentResponsibilities: ["release-watch", "qa-sweep"],
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
    expect(h.deleteAgentResponsibilityFile).not.toHaveBeenCalled();
    expect(h.writeConfigPatch).toHaveBeenCalledWith(
      octokit,
      "acme",
      "widgets",
      { activeAgentResponsibilities: ["qa-sweep"] },
      "chore(kody): remove store agentResponsibility release-watch",
    );
    expect(h.recordAudit).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        action: "agentResponsibility.removeStoreReference",
        resource: "release-watch",
      }),
    );
  });

  it("clears active Store agentResponsibilities when the last reference is removed", async () => {
    h.readAgentResponsibilityFile.mockResolvedValue(null);
    h.getEngineConfig.mockResolvedValue({
      config: {
        company: {
          activeAgentResponsibilities: ["release-watch"],
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
      { activeAgentResponsibilities: null },
      "chore(kody): remove store agentResponsibility release-watch",
    );
  });

  it("keeps local folder deletion for local agentResponsibilities", async () => {
    const octokit = { rest: {} };
    h.getUserOctokit.mockResolvedValue(octokit);
    h.readAgentResponsibilityFile.mockResolvedValue({
      slug: "release-watch",
      title: "Release Watch",
      agent: "kody",
    });

    const res = await DELETE(deleteRequest(), params());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(h.deleteAgentResponsibilityFile).toHaveBeenCalledWith(
      octokit,
      "release-watch",
    );
    expect(h.writeConfigPatch).not.toHaveBeenCalled();
    expect(h.recordAudit).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        action: "agentResponsibility.delete",
        agent: "kody",
      }),
    );
  });
});
