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
}));

const stateRepo = vi.hoisted(() => ({
  deleteStateDirectory: vi.fn(async () => ({ deleted: 2 })),
  resolveStateRepo: vi.fn(),
  stateRepoPath: vi.fn(),
}));

vi.mock("@dashboard/lib/auth", () => ({
  requireKodyAuth: auth.requireKodyAuth,
  getRequestAuth: auth.getRequestAuth,
  getUserOctokit: auth.getUserOctokit,
}));

vi.mock("@dashboard/lib/state-repo", () => ({
  deleteStateDirectory: stateRepo.deleteStateDirectory,
  resolveStateRepo: stateRepo.resolveStateRepo,
  stateRepoPath: stateRepo.stateRepoPath,
}));

vi.mock("@dashboard/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { DELETE } from "../../app/api/kody/views/route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DELETE /api/kody/views", () => {
  it("deletes the repo-backed view folder from the configured state repo", async () => {
    const res = await DELETE(
      new NextRequest("http://localhost/api/kody/views?view=mobile-html-1234", {
        method: "DELETE",
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, deleted: 2 });
    expect(stateRepo.deleteStateDirectory).toHaveBeenCalledWith({
      octokit: { marker: "viewer-octokit" },
      owner: "acme",
      repo: "widgets",
      path: "views/mobile-html-1234",
      message: "chore(dashboard): remove static view mobile-html-1234",
    });
  });

  it("rejects unsafe view ids", async () => {
    const res = await DELETE(
      new NextRequest("http://localhost/api/kody/views?view=../bad", {
        method: "DELETE",
      }),
    );

    expect(res.status).toBe(400);
    expect(stateRepo.deleteStateDirectory).not.toHaveBeenCalled();
  });
});
