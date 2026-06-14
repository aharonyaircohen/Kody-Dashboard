/**
 * Unit tests for the ticked-markdown read path
 * (src/dashboard/lib/ticked/files.ts → parseTickedMarkdown). The detail
 * view renders `title` in the header AND `body` via ReactMarkdown, so the
 * title H1 MUST be stripped from `body` — otherwise it renders twice. A
 * past regression let it survive (stripLeadingH1 saw the blank line that
 * follows the frontmatter `---` and stripped nothing), and repeated
 * dashboard writes then stacked 2–3 copies into the body. These tests lock
 * the strip in place. Pure logic — no GitHub calls.
 */
import { describe, it, expect } from "vitest";
import { parseTickedMarkdown } from "@dashboard/lib/ticked/files";

describe("parseTickedMarkdown", () => {
  it("strips the title H1 from the body when a frontmatter block precedes it", () => {
    // The blank line after `---` is the exact thing that defeated the old
    // stripLeadingH1: the body it receives starts with "\n# Title".
    const raw =
      "---\nevery: 30m\nstaff: qa\ndisabled: true\n---\n\n# QA Changelog Verification\n\n## Job\n\nDo the QA.\n";
    const { title, body } = parseTickedMarkdown(raw, "qa");
    expect(title).toBe("QA Changelog Verification");
    expect(body.startsWith("## Job")).toBe(true);
    expect(body).not.toContain("# QA Changelog Verification");
  });

  it("collapses multiple leaked leading title copies (the corruption shape)", () => {
    const raw =
      "---\nevery: 7d\nstaff: cto\n---\n\n# Architecture Audit\n\n# Architecture Audit\n\n# Architecture Audit\n\n## Jobs\n\nSweep.\n";
    const { title, body } = parseTickedMarkdown(raw, "architecture-audit");
    expect(title).toBe("Architecture Audit");
    expect(body.startsWith("## Jobs")).toBe(true);
    expect(body).not.toContain("# Architecture Audit");
  });

  it("strips a leading H1 (and its duplicates) with no frontmatter block", () => {
    const raw = "# CEO\n\n# CEO\n\n> Identity only.\n";
    const { title, body } = parseTickedMarkdown(raw, "ceo");
    expect(title).toBe("CEO");
    expect(body.startsWith("> Identity only.")).toBe(true);
    expect(body).not.toContain("# CEO");
  });

  it("only strips LEADING H1s — a heading deeper in the body survives", () => {
    const raw =
      "---\nevery: 1h\n---\n\n# Title\n\n## Section\n\n# A real in-body heading\n";
    const { title, body } = parseTickedMarkdown(raw, "x");
    expect(title).toBe("Title");
    expect(body).toContain("# A real in-body heading");
  });

  it("falls back to a humanized slug when the body has no H1", () => {
    const { title, body } = parseTickedMarkdown(
      "---\nevery: 1h\n---\n\nJust prose, no heading.\n",
      "pr-health-triage",
    );
    expect(title).toBe("Pr Health Triage");
    expect(body.startsWith("Just prose")).toBe(true);
  });
});
