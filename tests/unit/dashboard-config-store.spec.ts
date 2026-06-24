import { beforeEach, describe, expect, it, vi } from "vitest";

const stateRepo = vi.hoisted(() => ({
  readStateText: vi.fn(),
  writeStateText: vi.fn(),
}));

vi.mock("@dashboard/lib/state-repo", () => ({
  readStateText: stateRepo.readStateText,
  writeStateText: stateRepo.writeStateText,
}));

vi.mock("@dashboard/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  DASHBOARD_CONFIG_PATH,
  invalidateDashboardConfigCache,
  readDashboardConfig,
  writeDashboardConfig,
  type DashboardConfig,
} from "@dashboard/lib/dashboard-config/store";

function fakeOctokit() {
  return { marker: "octokit" } as never;
}

const DOC: DashboardConfig = {
  version: 1,
  defaultPreviewUrl: "https://preview.example",
  namedPreviews: [
    {
      id: "web",
      label: "Web",
      url: "https://preview.example",
      repoViewPath: ".kody/views/legacy-view",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  invalidateDashboardConfigCache("acme", "widgets");
});

describe("dashboard config store", () => {
  it("reads dashboard.json from the configured state repo", async () => {
    const octokit = fakeOctokit();
    stateRepo.readStateText.mockResolvedValue({
      content: JSON.stringify(DOC),
      sha: "sha-1",
    });

    const { doc, sha } = await readDashboardConfig(octokit, "acme", "widgets");

    expect(doc).toEqual(DOC);
    expect(sha).toBe("sha-1");
    expect(stateRepo.readStateText).toHaveBeenCalledWith(
      octokit,
      "acme",
      "widgets",
      DASHBOARD_CONFIG_PATH,
      { headers: { "If-None-Match": "" } },
    );
  });

  it("writes dashboard.json to the configured state repo", async () => {
    const octokit = fakeOctokit();
    stateRepo.writeStateText.mockResolvedValue({ sha: "sha-2" });

    const { sha } = await writeDashboardConfig(
      octokit,
      "acme",
      "widgets",
      DOC,
      "sha-1",
    );

    expect(sha).toBe("sha-2");
    expect(stateRepo.writeStateText).toHaveBeenCalledWith({
      octokit,
      owner: "acme",
      repo: "widgets",
      path: DASHBOARD_CONFIG_PATH,
      content: JSON.stringify(DOC, null, 2),
      message: "chore(dashboard): update dashboard config",
      sha: "sha-1",
    });
  });
});
