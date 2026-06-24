import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(),
  verifyActorLogin: vi.fn(),
  getUserOctokit: vi.fn(),
  getRequestAuth: vi.fn(),
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
  readCommandFile: vi.fn(),
  writeCommandFile: vi.fn(),
  deleteCommandFile: vi.fn(),
  listCommands: vi.fn(),
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

vi.mock("@dashboard/lib/commands", () => ({
  readCommandFile: h.readCommandFile,
  writeCommandFile: h.writeCommandFile,
  deleteCommandFile: h.deleteCommandFile,
  listCommands: h.listCommands,
  isValidSlug: (slug: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug),
}));

vi.mock("@dashboard/lib/engine/config", () => ({
  getEngineConfig: h.getEngineConfig,
  writeConfigPatch: h.writeConfigPatch,
}));

vi.mock("@dashboard/lib/activity/audit", () => ({
  recordAudit: h.recordAudit,
}));

import { DELETE } from "../../app/api/kody/commands/[slug]/route";

function deleteRequest() {
  return new NextRequest(
    "http://localhost/api/kody/commands/factory?actorLogin=alice",
    { method: "DELETE" },
  );
}

function params(slug = "factory") {
  return { params: Promise.resolve({ slug }) };
}

describe("DELETE /api/kody/commands/:slug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.requireKodyAuth.mockResolvedValue(null);
    h.verifyActorLogin.mockResolvedValue({
      identity: { login: "alice", avatar_url: "u", githubId: 1 },
    });
    h.getRequestAuth.mockReturnValue({
      token: "ghp_test",
      owner: "acme",
      repo: "widgets",
    });
    h.getUserOctokit.mockResolvedValue({ rest: {} });
    h.writeConfigPatch.mockResolvedValue({ sha: "next-sha" });
  });

  it("removes an imported Store command reference from config", async () => {
    h.readCommandFile.mockResolvedValue(null);
    h.getEngineConfig.mockResolvedValue({
      config: {
        agentActions: { default: "run" },
        company: { activeCommands: ["factory", "plan"] },
      },
      sha: "config-sha",
    });

    const res = await DELETE(deleteRequest(), params());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      removedStoreReference: true,
    });
    expect(h.writeConfigPatch).toHaveBeenCalledWith(
      { rest: {} },
      "acme",
      "widgets",
      { activeCommands: ["plan"] },
      "chore(kody): remove store command factory",
    );
    expect(h.deleteCommandFile).not.toHaveBeenCalled();
    expect(h.recordAudit).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({ action: "command.removeStoreReference" }),
    );
  });

  it("keeps local command deletion for repo commands", async () => {
    const octokit = { rest: {} };
    h.getUserOctokit.mockResolvedValue(octokit);
    h.readCommandFile.mockResolvedValue({ slug: "factory", sha: "abc" });

    const res = await DELETE(deleteRequest(), params());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(h.deleteCommandFile).toHaveBeenCalledWith(octokit, "factory");
    expect(h.writeConfigPatch).not.toHaveBeenCalled();
  });
});
