import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const githubClient = vi.hoisted(() => ({
  createUserOctokit: vi.fn(() => ({ marker: "octokit" })),
}));

const backgroundToken = vi.hoisted(() => ({
  resolveBackgroundToken: vi.fn(
    async (): Promise<{ token: string; source: "app" } | null> => ({
      token: "ghs_app_token",
      source: "app" as const,
    }),
  ),
}));

const stateRepo = vi.hoisted(() => ({
  resolveStateRepo: vi.fn(async () => ({
    owner: "octo-state",
    repo: "kody-state",
    basePath: "repo",
  })),
  stateRepoPath: vi.fn((target: { basePath: string }, path: string) =>
    [target.basePath, path].filter(Boolean).join("/"),
  ),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  createUserOctokit: githubClient.createUserOctokit,
}));

vi.mock("@dashboard/lib/auth/background-token", () => ({
  resolveBackgroundToken: backgroundToken.resolveBackgroundToken,
}));

vi.mock("@dashboard/lib/state-repo", () => ({
  resolveStateRepo: stateRepo.resolveStateRepo,
  stateRepoPath: stateRepo.stateRepoPath,
}));

import { GET } from "../app/api/kody/views/[...path]/route";
import { mintRepoViewToken } from "@dashboard/lib/view-token";

const ORIGINAL_MASTER_KEY = process.env.KODY_MASTER_KEY;

function mintTicket(viewId = "pdf-f7fef487"): string {
  return mintRepoViewToken({
    owner: "octo",
    repo: "repo",
    viewId,
    githubToken: "ghs_test_token",
    ttlSeconds: 60,
  }).token;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.KODY_MASTER_KEY = "test-master-key";
});

afterEach(() => {
  if (ORIGINAL_MASTER_KEY) {
    process.env.KODY_MASTER_KEY = ORIGINAL_MASTER_KEY;
  } else {
    delete process.env.KODY_MASTER_KEY;
  }
  vi.restoreAllMocks();
});

describe("repo-backed view serving", () => {
  it("serves direct PDF URLs inline PDF bytes from the state repo", async () => {
    const token = mintTicket();
    const pdf = Buffer.from("%PDF-1.4\nbody");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(pdf, {
        status: 200,
        headers: { "Content-Type": "application/vnd.github.raw+json" },
      }),
    );
    const req = new NextRequest(
      `http://localhost/api/kody/views/_t/${token}/pdf-f7fef487/-_-.pdf`,
    );

    const res = await GET(req, {
      params: Promise.resolve({
        path: ["_t", token, "pdf-f7fef487", "-_-.pdf"],
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe(
      'inline; filename="-_-.pdf"',
    );
    expect(Buffer.from(await res.arrayBuffer()).toString("utf8")).toBe(
      pdf.toString("utf8"),
    );
    expect(backgroundToken.resolveBackgroundToken).toHaveBeenCalledWith(
      "octo",
      "repo",
    );
    expect(githubClient.createUserOctokit).toHaveBeenCalledWith(
      "ghs_app_token",
    );
    expect(stateRepo.resolveStateRepo).toHaveBeenCalledWith(
      { marker: "octokit" },
      "octo",
      "repo",
    );
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "/repos/octo-state/kody-state/contents/repo/views/pdf-f7fef487/-_-.pdf",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: "Bearer ghs_app_token",
      }),
    });
  });

  it("falls back to the viewer token when no background token is available", async () => {
    backgroundToken.resolveBackgroundToken.mockResolvedValueOnce(null);
    const token = mintTicket("view-123");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Buffer.from("<h1>ok</h1>"), { status: 200 }),
    );
    const req = new NextRequest(
      `http://localhost/api/kody/views/_t/${token}/view-123/index.html`,
    );

    const res = await GET(req, {
      params: Promise.resolve({
        path: ["_t", token, "view-123", "index.html"],
      }),
    });

    expect(res.status).toBe(200);
    expect(githubClient.createUserOctokit).toHaveBeenCalledWith(
      "ghs_test_token",
    );
  });

  it("returns 404 when the state repo view file does not exist", async () => {
    const token = mintTicket("view-123");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 404 }),
    );
    const req = new NextRequest(
      `http://localhost/api/kody/views/_t/${token}/view-123/index.html`,
    );

    const res = await GET(req, {
      params: Promise.resolve({
        path: ["_t", token, "view-123", "index.html"],
      }),
    });

    await expect(res.json()).resolves.toEqual({ error: "view_file_not_found" });
    expect(res.status).toBe(404);
  });
});
