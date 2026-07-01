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

function file(
  content: string,
  size = content.length,
  htmlUrl = "https://github.com/acme/kody-state/blob/main/widgets/reports/file.md",
) {
  return {
    type: "file",
    encoding: "base64",
    content: b64(content),
    sha: "sha-file",
    size,
    html_url: htmlUrl,
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
    octokit.repos.getContent
      .mockRejectedValueOnce({ status: 404 })
      .mockResolvedValueOnce({
        data: file("# Weekly Scan\n\nNeeds attention.", 64),
      });

    const report = await readReportFile("weekly-scan");

    expect(octokit.repos.getContent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        owner: "acme",
        repo: "kody-state",
        path: "widgets/reports/weekly-scan/runs",
      }),
    );
    expect(octokit.repos.getContent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        owner: "acme",
        repo: "kody-state",
        path: "widgets/reports/weekly-scan.md",
      }),
    );
    expect(report).toEqual(
      expect.objectContaining({
        slug: "weekly-scan",
        path: "reports/weekly-scan.md",
        runId: null,
        runs: [],
        title: "Weekly Scan",
        body: "Needs attention.",
        size: 64,
      }),
    );
  });

  it("strips report frontmatter and exposes review metadata", async () => {
    const octokit = wireOctokit();
    octokit.repos.getContent
      .mockRejectedValueOnce({ status: 404 })
      .mockResolvedValueOnce({
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
    octokit.repos.getContent
      .mockRejectedValueOnce({ status: 404 })
      .mockResolvedValueOnce({
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

  it("lists report folders by showing the latest run and run history", async () => {
    const octokit = wireOctokit();
    octokit.repos.getContent
      .mockResolvedValueOnce({
        data: [
          {
            name: "ai-agency-doctor",
            type: "dir",
            path: "widgets/reports/ai-agency-doctor",
          },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          {
            name: "2026-06-27T11-48-36Z.md",
            type: "file",
            path: "widgets/reports/ai-agency-doctor/runs/2026-06-27T11-48-36Z.md",
            size: 100,
            html_url:
              "https://github.com/acme/kody-state/blob/main/widgets/reports/ai-agency-doctor/runs/2026-06-27T11-48-36Z.md",
          },
          {
            name: "2026-06-28T09-44-32Z.md",
            type: "file",
            path: "widgets/reports/ai-agency-doctor/runs/2026-06-28T09-44-32Z.md",
            size: 120,
            html_url:
              "https://github.com/acme/kody-state/blob/main/widgets/reports/ai-agency-doctor/runs/2026-06-28T09-44-32Z.md",
          },
        ],
      })
      .mockResolvedValueOnce({
        data: file(
          [
            "---",
            'generatedAt: "2026-06-28T09:44:32Z"',
            "findings:",
            "  - id: doctor-red",
            "    severity: high",
            "    title: Broken wiring",
            "---",
            "# AI Agency Doctor",
            "",
            "AI Agency Health: Red",
          ].join("\n"),
          120,
          "https://github.com/acme/kody-state/blob/main/widgets/reports/ai-agency-doctor/runs/2026-06-28T09-44-32Z.md",
        ),
      });

    const reports = await listReportFiles();

    expect(reports).toEqual([
      expect.objectContaining({
        slug: "ai-agency-doctor",
        path: "reports/ai-agency-doctor/runs/2026-06-28T09-44-32Z.md",
        runId: "2026-06-28T09-44-32Z",
        title: "AI Agency Doctor",
        body: "AI Agency Health: Red",
        updatedAt: "2026-06-28T09:44:32Z",
        findingCount: 1,
      }),
    ]);
    expect(reports[0]?.runs.map((run) => run.id)).toEqual([
      "2026-06-28T09-44-32Z",
      "2026-06-27T11-48-36Z",
    ]);
  });

  it("prefers report folder runs over a legacy flat report with the same slug", async () => {
    const octokit = wireOctokit();
    octokit.repos.getContent
      .mockResolvedValueOnce({
        data: [
          {
            name: "2026-06-28T09-44-32Z.md",
            type: "file",
            path: "widgets/reports/ai-agency-doctor/runs/2026-06-28T09-44-32Z.md",
            size: 120,
          },
        ],
      })
      .mockResolvedValueOnce({
        data: file(
          "# AI Agency Doctor\n\nLatest run.",
          120,
          "https://github.com/acme/kody-state/blob/main/widgets/reports/ai-agency-doctor/runs/2026-06-28T09-44-32Z.md",
        ),
      });

    const report = await readReportFile("ai-agency-doctor");

    expect(report).toEqual(
      expect.objectContaining({
        slug: "ai-agency-doctor",
        path: "reports/ai-agency-doctor/runs/2026-06-28T09-44-32Z.md",
        runId: "2026-06-28T09-44-32Z",
        body: "Latest run.",
      }),
    );
    expect(octokit.repos.getContent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        path: "widgets/reports/ai-agency-doctor.md",
      }),
    );
  });

  it("reads a selected report folder run instead of always returning the latest", async () => {
    const octokit = wireOctokit();
    octokit.repos.getContent
      .mockResolvedValueOnce({
        data: [
          {
            name: "2026-06-28T09-44-32Z.md",
            type: "file",
            path: "widgets/reports/ai-agency-doctor/runs/2026-06-28T09-44-32Z.md",
            size: 120,
            html_url:
              "https://github.com/acme/kody-state/blob/main/widgets/reports/ai-agency-doctor/runs/2026-06-28T09-44-32Z.md",
          },
          {
            name: "2026-06-27T11-48-36Z.md",
            type: "file",
            path: "widgets/reports/ai-agency-doctor/runs/2026-06-27T11-48-36Z.md",
            size: 100,
            html_url:
              "https://github.com/acme/kody-state/blob/main/widgets/reports/ai-agency-doctor/runs/2026-06-27T11-48-36Z.md",
          },
        ],
      })
      .mockResolvedValueOnce({
        data: file(
          "# AI Agency Doctor\n\nEarlier run.",
          100,
          "https://github.com/acme/kody-state/blob/main/widgets/reports/ai-agency-doctor/runs/2026-06-27T11-48-36Z.md",
        ),
      });

    const report = await readReportFile(
      "ai-agency-doctor",
      "2026-06-27T11-48-36Z",
    );

    expect(octokit.repos.getContent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: "widgets/reports/ai-agency-doctor/runs/2026-06-27T11-48-36Z.md",
      }),
    );
    expect(report).toEqual(
      expect.objectContaining({
        slug: "ai-agency-doctor",
        path: "reports/ai-agency-doctor/runs/2026-06-27T11-48-36Z.md",
        runId: "2026-06-27T11-48-36Z",
        body: "Earlier run.",
      }),
    );
    expect(report?.runs.map((run) => run.id)).toEqual([
      "2026-06-28T09-44-32Z",
      "2026-06-27T11-48-36Z",
    ]);
  });
});
