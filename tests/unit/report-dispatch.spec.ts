import { describe, it, expect } from "vitest";
import {
  extractTouchedReportSlugs,
  isPushToDefaultBranch,
  stripVolatileLines,
} from "../../src/dashboard/lib/push/report-dispatch";

describe("stripVolatileLines", () => {
  it("treats a timestamp-only re-save as unchanged", () => {
    const before = [
      "# Job Gap Scan",
      "",
      "_Cadence: daily — one proposed duty per cycle, advisory only._",
      "",
      "_Last updated: 2026-05-31T09:21:35Z_",
      "",
      "## Current proposal",
      "- propose sentry-digest",
    ].join("\n");
    const after = before.replace(
      "2026-05-31T09:21:35Z",
      "2026-05-31T10:17:39Z",
    );
    expect(before).not.toEqual(after); // raw bodies differ…
    expect(stripVolatileLines(before)).toEqual(stripVolatileLines(after)); // …but content doesn't
  });

  it("detects a real content change even with a new timestamp", () => {
    const before = [
      "# Health Check",
      "_Last updated: 2026-05-31T09:00:00Z_",
      "## running",
      "- #1583 — 436h since last update",
    ].join("\n");
    const after = [
      "# Health Check",
      "_Last updated: 2026-05-31T10:00:00Z_",
      "## running",
      "- #1583 — 461h since last update",
    ].join("\n");
    expect(stripVolatileLines(before)).not.toEqual(stripVolatileLines(after));
  });

  it("matches the volatile line regardless of emphasis / blockquote wrapping", () => {
    expect(stripVolatileLines("_Last updated: x_\nbody")).toEqual("body");
    expect(stripVolatileLines("*Last updated: x*\nbody")).toEqual("body");
    expect(stripVolatileLines("> Last updated: x\nbody")).toEqual("body");
    expect(stripVolatileLines("  last updated: x\nbody")).toEqual("body");
  });

  it("leaves non-timestamp content intact", () => {
    const md = "# Title\n\nSome finding about last updated dependencies.";
    // "last updated" mid-sentence is not at line start → not stripped.
    expect(stripVolatileLines(md)).toEqual(md);
  });
});

describe("extractTouchedReportSlugs", () => {
  it("collects added + modified top-level report slugs, deduped", () => {
    const payload = {
      commits: [
        {
          added: [".kody/reports/security-audit.md"],
          modified: [".kody/reports/job-gap-scan.md", "README.md"],
        },
        { modified: [".kody/reports/job-gap-scan.md"] },
      ],
    };
    expect(extractTouchedReportSlugs(payload).sort()).toEqual([
      "job-gap-scan",
      "security-audit",
    ]);
  });

  it("ignores nested files and non-markdown sidecars", () => {
    const payload = {
      commits: [
        {
          modified: [
            ".kody/reports/sub/nested.md",
            ".kody/reports/data.json",
            ".kody/reports/.disable",
          ],
        },
      ],
    };
    expect(extractTouchedReportSlugs(payload)).toEqual([]);
  });
});

describe("isPushToDefaultBranch", () => {
  it("is true only for a push to the repo default branch", () => {
    const base = { repository: { default_branch: "main" } };
    expect(isPushToDefaultBranch({ ...base, ref: "refs/heads/main" })).toBe(
      true,
    );
    expect(isPushToDefaultBranch({ ...base, ref: "refs/heads/feature" })).toBe(
      false,
    );
    expect(isPushToDefaultBranch({ ref: "refs/heads/main" })).toBe(false);
  });
});
