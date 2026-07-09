/**
 * @fileoverview Unit tests for creating agent entries.
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
  listResolvedAgentFiles: vi.fn(),
  readAgentFile: vi.fn(),
  writeAgentFile: vi.fn(),
  getEngineConfig: vi.fn(),
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
  listResolvedAgentFiles: h.listResolvedAgentFiles,
  readAgentFile: h.readAgentFile,
  writeAgentFile: h.writeAgentFile,
  isValidSlug: (slug: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug),
}));

vi.mock("@dashboard/lib/engine/config", () => ({
  getEngineConfig: h.getEngineConfig,
}));

vi.mock("@dashboard/lib/activity/audit", () => ({
  recordAudit: h.recordAudit,
}));

import { POST } from "../../app/api/kody/agents/route";

function request(body: Record<string, unknown>) {
  return new NextRequest("https://dash.test/api/kody/agents", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kody-token": "ghp_test-token",
      "x-kody-owner": "acme",
      "x-kody-repo": "widgets",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/kody/agents", () => {
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
    h.readAgentFile.mockResolvedValue(null);
    h.writeAgentFile.mockImplementation(async ({ slug, title, body }) => ({
      slug,
      title,
      body,
      sha: "agent-sha",
      updatedAt: "2026-07-09T00:00:00.000Z",
      htmlUrl: `https://github.com/acme/widgets/blob/main/agents/${slug}.md`,
    }));
  });

  it("creates an agent when a create surface sends a blank slug with a non-ascii title", async () => {
    const res = await POST(
      request({
        slug: "",
        title: "סוכן בדיקות",
        body: "Runs QA checks.",
        actorLogin: "alice",
      }),
    );

    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.agentMember.slug).toMatch(/^agent-[a-z0-9]+$/);
    expect(h.writeAgentFile).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: expect.stringMatching(/^agent-[a-z0-9]+$/),
        title: "סוכן בדיקות",
        body: "Runs QA checks.",
      }),
    );
  });

  it("normalizes an invalid requested slug instead of returning invalid_slug", async () => {
    const res = await POST(
      request({
        slug: "סוכן בדיקות",
        title: "QA Agent",
        body: "Runs QA checks.",
      }),
    );

    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.agentMember.slug).toMatch(/^agent-[a-z0-9]+$/);
    expect(h.writeAgentFile).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: expect.stringMatching(/^agent-[a-z0-9]+$/),
        title: "QA Agent",
      }),
    );
  });
});
