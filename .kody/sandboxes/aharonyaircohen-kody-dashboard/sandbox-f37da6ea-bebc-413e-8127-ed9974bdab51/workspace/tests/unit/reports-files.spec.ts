import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dashboard/lib/github-client", () => ({
  getOctokit: vi.fn(),
  getOwner: vi.fn(() => "acme"),
  getRepo: vi.fn(() => "widgets"),
}));

import { getOctokit } from "@dashboard/lib/github-client";
import { STATE_BRANCH } from "@dashboard/lib/state-branch";
import { listReportFiles, readReportFile } from "@dashboard/lib/reports-files";

const mGetOctokit = vi.mocked(getOctokit);

function b64(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

function wireOctokit() {
  const octokit = {
    repos: {
      getContent: vi.fn(),
      listCommits: vi.fn(),
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
  it("lists reports from the kody state branch", async () => {
    const octokit = wireOctokit();
    octokit.repos.getContent
      .mockResolvedValueOnce({
        data: [
          { name: "daily-check.md", type: "file", sha: "sha-1", size: 42 },
          { name: "notes.txt", type: "file", sha: "sha-2", size: 12 },
        ],
      })
      .mockResolvedValueOnce({
        data: {
          content: b64("# Daily Check\n\nAll clear."),
          size: 42,
        },
      });
    octokit.repos.listCommits.mockResolvedValue({
      data: [{ commit: { committer: { date: "2026-06-01T10:00:00Z" } } }],
    });

    const reports = await listReportFiles();

    expect(octokit.repos.getContent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        path: ".kody/reports",
        ref: STATE_BRANCH,
      }),
    );
    expect(octokit.repos.getContent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: ".kody/reports/daily-check.md",
        ref: STATE_BRANCH,
      }),
    );
    expect(octokit.repos.listCommits).toHaveBeenCalledWith(
      expect.objectContaining({
        path: ".kody/reports/daily-check.md",
        sha: STATE_BRANCH,
      }),
    );
    expect(reports).toEqual([
      expect.objectContaining({
        slug: "daily-check",
        title: "Daily Check",
        body: "All clear.",
        htmlUrl:
          "https://github.com/acme/widgets/blob/kody-state/.kody/reports/daily-check.md",
      }),
    ]);
  });

  it("reads a single report from the kody state branch", async () => {
    const octokit = wireOctokit();
    octokit.repos.getContent.mockResolvedValue({
      data: {
        content: b64("# Weekly Scan\n\nNeeds attention."),
        size: 64,
      },
    });
    octokit.repos.listCommits.mockResolvedValue({
      data: [{ commit: { author: { date: "2026-06-02T09:00:00Z" } } }],
    });

    const report = await readReportFile("weekly-scan");

    expect(octokit.repos.getContent).toHaveBeenCalledWith(
      expect.objectContaining({
        path: ".kody/reports/weekly-scan.md",
        ref: STATE_BRANCH,
      }),
    );
    expect(report).toEqual(
      expect.objectContaining({
        slug: "weekly-scan",
        updatedAt: "2026-06-02T09:00:00Z",
        htmlUrl:
          "https://github.com/acme/widgets/blob/kody-state/.kody/reports/weekly-scan.md",
      }),
    );
  });

  it("strips report frontmatter and exposes review metadata", async () => {
    const octokit = wireOctokit();
    octokit.repos.getContent.mockResolvedValue({
      data: {
        content: b64(
          [
            "---",
            'generatedAt: "2026-06-08T12:00:00Z"',
            "dutySlug: skills-research",
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
        ),
        size: 128,
      },
    });
    octokit.repos.listCommits.mockResolvedValue({
      data: [{ commit: { author: { date: "2026-06-02T09:00:00Z" } } }],
    });

    const report = await readReportFile("skills-research");

    expect(report).toEqual(
      expect.objectContaining({
        title: "Skills Research",
        body: "Only Vitest is missing.",
        dutySlug: "skills-research",
        reviewStatus: "action-needed",
        reviewArea: "engineering-capability",
        findingCount: 1,
      }),
    );
  });

  it("parses suggested actions from report frontmatter", async () => {
    const octokit = wireOctokit();
    octokit.repos.getContent.mockResolvedValue({
      data: {
        content: b64(
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
            "    executable: fix-ci",
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
        ),
        size: 256,
      },
    });
    octokit.repos.listCommits.mockResolvedValue({
      data: [{ commit: { author: { date: "2026-06-02T09:00:00Z" } } }],
    });

    const report = await readReportFile("ci-report");

    expect(report?.suggestedActions).toEqual([
      {
        id: "fix-ci-42",
        type: "dispatch",
        label: "Run fix-ci on PR #42",
        executable: "fix-ci",
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
