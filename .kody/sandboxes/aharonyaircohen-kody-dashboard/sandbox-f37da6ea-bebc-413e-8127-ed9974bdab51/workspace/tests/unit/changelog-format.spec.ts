/**
 * Unit tests for the changelog format module — pure transforms over a
 * Keep-a-Changelog markdown document.
 */
import { describe, it, expect } from "vitest";

import {
  appendUnreleasedEntry,
  promoteUnreleased,
  hasUnreleasedEntries,
  formatEntry,
  UNRELEASED_HEADER,
} from "@dashboard/lib/changelog/format";

const entry = {
  prNumber: 42,
  prUrl: "https://github.com/o/r/pull/42",
  title: "feat: add changelog",
  author: "alice",
};

describe("formatEntry", () => {
  it("produces a markdown bullet with PR link and author", () => {
    expect(formatEntry(entry)).toBe(
      "- feat: add changelog ([#42](https://github.com/o/r/pull/42)) — @alice",
    );
  });
});

describe("appendUnreleasedEntry", () => {
  it("creates a full template when input is empty", () => {
    const out = appendUnreleasedEntry("", entry);
    expect(out).toContain("# Changelog");
    expect(out).toContain(UNRELEASED_HEADER);
    expect(out).toContain("[#42]");
  });

  it("inserts the bullet directly under the Unreleased header", () => {
    const md = `# Changelog\n\n${UNRELEASED_HEADER}\n\n`;
    const out = appendUnreleasedEntry(md, entry);
    const lines = out.split("\n");
    const headerIdx = lines.findIndex((l) => l.trim() === UNRELEASED_HEADER);
    // header, blank, entry
    expect(lines[headerIdx + 2]).toContain("[#42]");
  });

  it("is idempotent on PR number", () => {
    const md = `${UNRELEASED_HEADER}\n\n- existing ([#42](url)) — @bob\n`;
    const out = appendUnreleasedEntry(md, entry);
    expect(out).toBe(md);
  });

  it("injects an Unreleased section when missing", () => {
    const md = "# Changelog\n\n## [1.0.0] - 2024-01-01\n\n- old entry\n";
    const out = appendUnreleasedEntry(md, entry);
    expect(out).toContain(UNRELEASED_HEADER);
    expect(out).toContain("[#42]");
    expect(out).toContain("## [1.0.0] - 2024-01-01");
  });

  it("places new bullets above older ones (newest-first ordering)", () => {
    let md = `${UNRELEASED_HEADER}\n\n`;
    md = appendUnreleasedEntry(md, { ...entry, prNumber: 1, title: "first" });
    md = appendUnreleasedEntry(md, { ...entry, prNumber: 2, title: "second" });
    const firstIdx = md.indexOf("[#1]");
    const secondIdx = md.indexOf("[#2]");
    expect(secondIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeLessThan(firstIdx);
  });
});

describe("hasUnreleasedEntries", () => {
  it("returns false for an empty Unreleased section", () => {
    const md = `${UNRELEASED_HEADER}\n\n## [1.0.0] - 2024-01-01\n\n- old\n`;
    expect(hasUnreleasedEntries(md)).toBe(false);
  });

  it("returns true when bullets exist before the next heading", () => {
    const md = `${UNRELEASED_HEADER}\n\n- entry\n\n## [1.0.0] - 2024-01-01\n`;
    expect(hasUnreleasedEntries(md)).toBe(true);
  });

  it("returns false when the Unreleased header is absent", () => {
    expect(
      hasUnreleasedEntries("# Changelog\n\n## [1.0.0] - 2024-01-01\n"),
    ).toBe(false);
  });
});

describe("promoteUnreleased", () => {
  it("renames Unreleased to a versioned section and adds a fresh Unreleased above", () => {
    const md = `${UNRELEASED_HEADER}\n\n- entry one\n\n## [1.0.0] - 2024-01-01\n`;
    const out = promoteUnreleased(md, "1.1.0", "2026-05-13T12:00:00Z");
    expect(out).toContain("## [Unreleased]\n\n## [1.1.0] - 2026-05-13");
    expect(out).toContain("- entry one");
    // The old release stays below.
    expect(out).toContain("## [1.0.0] - 2024-01-01");
    // New Unreleased section comes before the new version header.
    const unrIdx = out.indexOf(UNRELEASED_HEADER);
    const newVerIdx = out.indexOf("## [1.1.0]");
    expect(unrIdx).toBeLessThan(newVerIdx);
  });

  it("is a no-op when Unreleased section has no entries", () => {
    const md = `${UNRELEASED_HEADER}\n\n## [1.0.0] - 2024-01-01\n`;
    expect(promoteUnreleased(md, "1.1.0", "2026-05-13")).toBe(md);
  });

  it("is idempotent on the same version", () => {
    const md = `${UNRELEASED_HEADER}\n\n- entry\n`;
    const once = promoteUnreleased(md, "1.1.0", "2026-05-13");
    const twice = promoteUnreleased(once, "1.1.0", "2026-05-13");
    expect(twice).toBe(once);
  });

  it("strips the time portion from an ISO timestamp", () => {
    const md = `${UNRELEASED_HEADER}\n\n- entry\n`;
    const out = promoteUnreleased(md, "2.0.0", "2026-05-13T09:30:45Z");
    expect(out).toContain("## [2.0.0] - 2026-05-13");
    expect(out).not.toContain("09:30:45");
  });
});
