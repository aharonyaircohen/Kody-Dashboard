/**
 * @fileoverview Unit tests for creating context entries.
 * @testFramework vitest
 * @domain context
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
  listContextFiles: vi.fn(),
  readContextFile: vi.fn(),
  writeContextFile: vi.fn(),
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

vi.mock("@dashboard/lib/context/files", () => ({
  listContextFiles: h.listContextFiles,
  readContextFile: h.readContextFile,
  writeContextFile: h.writeContextFile,
  isValidSlug: (slug: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug),
}));

import { POST } from "../../app/api/kody/context/route";

function request(body: Record<string, unknown>) {
  return new NextRequest("https://dash.test/api/kody/context", {
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

describe("POST /api/kody/context", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    h.requireKodyAuth.mockResolvedValue(null);
    h.verifyActorLogin.mockResolvedValue({ identity: { login: "alice" } });
    h.getRequestAuth.mockReturnValue({
      token: "ghp_test-token",
      owner: "acme",
      repo: "widgets",
    });
    h.getUserOctokit.mockResolvedValue({ rest: {} });
    h.readContextFile.mockResolvedValue(null);
    h.writeContextFile.mockImplementation(async ({ slug, body, agent }) => ({
      slug,
      body,
      agent,
      sha: "context-sha",
      updatedAt: "2026-07-09T00:00:00.000Z",
      htmlUrl: `https://github.com/acme/widgets/blob/main/context/${slug}.md`,
    }));
  });

  it("creates a context entry from a human name", async () => {
    const res = await POST(
      request({
        name: "Company Profile",
        body: "Company facts.",
        agent: ["kody"],
        actorLogin: "alice",
      }),
    );

    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.entry.slug).toBe("company-profile");
    expect(h.writeContextFile).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "company-profile",
        body: "Company facts.",
        agent: ["kody"],
      }),
    );
  });

  it("keeps old slug payloads compatible", async () => {
    const res = await POST(
      request({
        slug: "mission-statement",
        body: "Mission.",
        agent: ["kody"],
      }),
    );

    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.entry.slug).toBe("mission-statement");
  });
});
