/**
 * Unit tests for `fetchPreviewForSha` (src/dashboard/lib/github-client.ts) —
 * the on-demand path that resolves a PR's Vercel preview URL directly by its
 * head commit. This is what lets the preview pane show a link immediately on
 * open, including for PRs that have aged out of the recent-100 deployment
 * window the bulk tasks-list scan uses.
 *
 * Invariants under test:
 *   1. Looks the deployment up BY the commit SHA (not a bulk list) and returns
 *      the status's `environment_url`.
 *   2. No matching deployment for the SHA → null (not a throw).
 *   3. Deployment exists but has no `environment_url` yet (still building) →
 *      null.
 *
 * Octokit is mocked at the `@octokit/rest` boundary, mirroring
 * github-client-cache.spec.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { listDeployments, listDeploymentStatuses } = vi.hoisted(() => ({
  listDeployments: vi.fn(),
  listDeploymentStatuses: vi.fn(),
}));

vi.mock("@octokit/plugin-throttling", () => ({ throttling: () => ({}) }));
vi.mock("@octokit/rest", () => {
  class FakeOctokit {
    repos = {
      listDeployments,
      listDeploymentStatuses,
    };
    static plugin() {
      return FakeOctokit;
    }
  }
  return { Octokit: FakeOctokit };
});

import {
  fetchPreviewForSha,
  setGitHubContext,
  clearGitHubContext,
  clearCache,
} from "@dashboard/lib/github-client";

const SHA = "17767ccbe2b2b7a7ed8acf47cfa762ef0181fcc6";

beforeEach(() => {
  clearCache();
  listDeployments.mockReset();
  listDeploymentStatuses.mockReset();
  setGitHubContext("acme", "widgets", "token-xyz");
});

afterEach(() => {
  clearGitHubContext();
});

describe("fetchPreviewForSha", () => {
  it("resolves the preview URL by the commit SHA", async () => {
    listDeployments.mockResolvedValue({
      data: [{ id: 999, sha: SHA }],
      headers: { etag: '"dep-v1"' },
    });
    listDeploymentStatuses.mockResolvedValue({
      data: [
        { state: "success", environment_url: "https://preview.example.app" },
      ],
      headers: { etag: '"status-v1"' },
    });

    const url = await fetchPreviewForSha(SHA);

    expect(url).toBe("https://preview.example.app");
    // Looked it up by the commit, scoped to the Preview environment.
    expect(listDeployments).toHaveBeenCalledWith(
      expect.objectContaining({ sha: SHA, environment: "Preview" }),
    );
  });

  it("returns null when no deployment exists for the SHA", async () => {
    listDeployments.mockResolvedValue({ data: [], headers: {} });

    const url = await fetchPreviewForSha(SHA);

    expect(url).toBeNull();
    // No deployment id → never asks for a status.
    expect(listDeploymentStatuses).not.toHaveBeenCalled();
  });

  it("returns null while the deployment is still building (no environment_url)", async () => {
    listDeployments.mockResolvedValue({
      data: [{ id: 999, sha: SHA }],
      headers: {},
    });
    listDeploymentStatuses.mockResolvedValue({
      data: [{ state: "in_progress", environment_url: null }],
      headers: {},
    });

    const url = await fetchPreviewForSha(SHA);

    expect(url).toBeNull();
  });

  it("returns null for an empty SHA without calling GitHub", async () => {
    const url = await fetchPreviewForSha("");

    expect(url).toBeNull();
    expect(listDeployments).not.toHaveBeenCalled();
  });
});
