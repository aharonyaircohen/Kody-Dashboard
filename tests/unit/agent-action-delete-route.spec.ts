/**
 * @fileoverview Unit tests for deleting/removing agentAction entries.
 * @testFramework vitest
 * @domain agent-actions
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
  readAgentActionFile: vi.fn(),
  readResolvedAgentActionFile: vi.fn(),
  writeAgentActionFile: vi.fn(),
  deleteAgentActionFile: vi.fn(),
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

vi.mock("@dashboard/lib/agent-actions", () => ({
  readAgentActionFile: h.readAgentActionFile,
  readResolvedAgentActionFile: h.readResolvedAgentActionFile,
  writeAgentActionFile: h.writeAgentActionFile,
  deleteAgentActionFile: h.deleteAgentActionFile,
  isValidSlug: (slug: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug),
  PERMISSION_MODES: ["default", "acceptEdits", "plan", "bypassPermissions"],
}));

vi.mock("@dashboard/lib/engine/config", () => ({
  getEngineConfig: h.getEngineConfig,
  writeConfigPatch: h.writeConfigPatch,
}));

vi.mock("@dashboard/lib/activity/audit", () => ({
  recordAudit: h.recordAudit,
}));

import { DELETE } from "../../app/api/kody/agent-actions/[slug]/route";

function deleteRequest(slug = "ship-feature") {
  return new NextRequest(
    `https://dash.test/api/kody/agent-actions/${slug}?actorLogin=alice`,
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

function params(slug = "ship-feature") {
  return { params: Promise.resolve({ slug }) };
}

describe("DELETE /api/kody/agent-actions/[slug]", () => {
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
      config: { company: { activeAgentActions: [] } },
      sha: "config-sha",
    });
    h.writeConfigPatch.mockResolvedValue({ sha: "next-sha" });
  });

  it("removes an active Store agentAction reference when no local folder exists", async () => {
    const octokit = { rest: {} };
    h.getUserOctokit.mockResolvedValue(octokit);
    h.readAgentActionFile.mockResolvedValue(null);
    h.getEngineConfig.mockResolvedValue({
      config: {
        company: {
          activeAgentActions: ["ship-feature", "fix-ci"],
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
    expect(h.deleteAgentActionFile).not.toHaveBeenCalled();
    expect(h.writeConfigPatch).toHaveBeenCalledWith(
      octokit,
      "acme",
      "widgets",
      { activeAgentActions: ["fix-ci"] },
      "chore(kody): remove store agentAction ship-feature",
    );
    expect(h.recordAudit).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        action: "agentAction.removeStoreReference",
        resource: "ship-feature",
      }),
    );
  });

  it("clears active Store agentActions when the last reference is removed", async () => {
    h.readAgentActionFile.mockResolvedValue(null);
    h.getEngineConfig.mockResolvedValue({
      config: {
        company: {
          activeAgentActions: ["ship-feature"],
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
      { activeAgentActions: null },
      "chore(kody): remove store agentAction ship-feature",
    );
  });

  it("keeps local folder deletion for local agentActions", async () => {
    const octokit = { rest: {} };
    h.getUserOctokit.mockResolvedValue(octokit);
    h.readAgentActionFile.mockResolvedValue({
      slug: "ship-feature",
      describe: "Ship feature",
    });

    const res = await DELETE(deleteRequest(), params());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(h.deleteAgentActionFile).toHaveBeenCalledWith(
      octokit,
      "ship-feature",
    );
    expect(h.writeConfigPatch).not.toHaveBeenCalled();
    expect(h.recordAudit).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        action: "agentAction.delete",
        resource: "ship-feature",
      }),
    );
  });
});
