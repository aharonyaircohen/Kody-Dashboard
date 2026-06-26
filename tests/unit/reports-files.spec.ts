import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dashboard/lib/github-client", () => ({
  getOctokit: vi.fn(),
  getOwner: vi.fn(() => "acme"),
  getRepo: vi.fn(() => "widgets"),
}));

vi.mock("@dashboard/lib/engine/config", () => ({
  getEngineConfig: vi.fn().mockResolvedValue({
    config: {
      executables: { default: "run" },
      state: { repo: "https://github.com/acme/kody-state", path: "widgets" },
    },
    sha: null,
  }),
}));

import { getOctokit } from "@dashboard/lib/github-client";
import { listReportFiles, readReportFile } from "@dashboard/lib/reports-files";

const mGetOctokit = vi.mocked(getOctokit);

function b64(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

function file(content: string, size = content.length) {
  return {
    type: "file",
    encoding: "base64",
    content: b64(content),
    sha: "sha-file",
    size,
    html_url:
      "https://github.com/acme/kody-state/blob/main/widgets/reports/file.md",
  };
}

function wireOctokit() {
  const octokit = {
    repos: {
      getContent: vi.fn(),
    },
  };
  mGetOctokit.mockReturnValue(
    octokit as unknown as ReturnType<typeof getOctokit>,
  );
  return octokit;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("report files", () => {
  it("lists reports from the configured Kody state repo", async () => {
    const octokit = wireOctokit();
    octokit.repos.getContent
      .mockResolvedValueOnce({
        data: [
          {
            name: "daily-check.md",
            type: "file",
            path: "widgets/reports/daily-check.md",
            size: 42,
          },
          {
            name: "notes.txt",
            type: "file",
            path: "widgets/reports/notes.txt",
            size: 12,
          },
        ],
      })
      .mockResolvedValueOnce({
        data: file("# Daily Check\n\nAll clear.", 42),
      });

    const reports = await listReportFiles();

    expect(octokit.repos.getContent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        owner: "acme",
        repo: "kody-state",
        path: "widgets/reports",
      }),
    );
    expect(octokit.repos.getContent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        owner: "acme",
        repo: "kody-state",
        path: "widgets/reports/daily-check.md",
      }),
    );
    expect(reports).toEqual([
      expect.objectContaining({
        slug: "daily-check",
        title: "Daily Check",
        body: "All clear.",
        size: 42,
      }),
    ]);
  });

  it("reads a single report from the configured Kody state repo", async () => {
    const octokit = wireOctokit();
    octokit.repos.getContent.mockResolvedValue({
      data: file("# Weekly Scan\n\nNeeds attention.", 64),
    });

    const report = await readReportFile("weekly-scan");

    expect(octokit.repos.getContent).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "kody-state",
        path: "widgets/reports/weekly-scan.md",
      }),
    );
    expect(report).toEqual(
      expect.objectContaining({
        slug: "weekly-scan",
        title: "Weekly Scan",
        body: "Needs attention.",
        size: 64,
      }),
    );
  });

  it("strips report frontmatter and exposes review metadata", async () => {
    const octokit = wireOctokit();
    octokit.repos.getContent.mockResolvedValue({
      data: file(
        [
          "---",
          'generatedAt: "2026-06-08T12:00:00Z"',
          "capabilitySlug: skills-research",
          "reviewStatus: action-needed",
          "reviewArea: engineering-capability",
          "findings:",
          "  - id: missing-vitest",
          "    severity: medium",
          "    title: Add Vitest skill",
          "---",
          "# Skills Research",
          "",
          "Only Vitest is missing.",
        ].join("\n"),
        128,
      ),
    });

    const report = await readReportFile("skills-research");

    expect(report).toEqual(
      expect.objectContaining({
        title: "Skills Research",
        body: "Only Vitest is missing.",
        capabilitySlug: "skills-research",
        reviewStatus: "action-needed",
        reviewArea: "engineering-capability",
        findingCount: 1,
      }),
    );
  });

  it("parses suggested actions from report frontmatter", async () => {
    const octokit = wireOctokit();
    octokit.repos.getContent.mockResolvedValue({
      data: file(
        [
          "---",
          'generatedAt: "2026-06-08T12:00:00Z"',
          "findings:",
          "  - id: failing-ci",
          "    severity: high",
          "    title: CI is red",
          "suggestedActions:",
          "  - id: fix-ci-42",
          "    type: dispatch",
          "    label: Run fix-ci on PR #42",
          "    capability: fix-ci",
          "    target: 42",
          "    reason: Unit tests failed",
          "  - id: task-flaky-test",
          "    type: create-task",
          "    label: Create task for flaky test",
          "    title: Fix flaky dashboard test",
          "    labels: from-report,ci",
          "---",
          "# CI Report",
          "",
          "CI is failing.",
        ].join("\n"),
        256,
      ),
    });

    const report = await readReportFile("ci-report");

    expect(report?.suggestedActions).toEqual([
      {
        id: "fix-ci-42",
        type: "dispatch",
        label: "Run fix-ci on PR #42",
        capability: "fix-ci",
        target: 42,
        reason: "Unit tests failed",
      },
      {
        id: "task-flaky-test",
        type: "create-task",
        label: "Create task for flaky test",
        title: "Fix flaky dashboard test",
        labels: ["from-report", "ci"],
      },
    ]);
  });
});
