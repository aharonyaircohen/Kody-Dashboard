/**
 * Unit tests for the ticked-markdown frontmatter parser
 * (src/dashboard/lib/ticked/frontmatter.ts). Every job/worker file's
 * schedule + worker binding is decoded here; a parse bug silently changes
 * whether (and as whom) a job auto-fires. Pure logic, was at ~4% coverage.
 */
import { describe, it, expect } from "vitest";
import {
  splitFrontmatter,
  joinFrontmatter,
  isScheduleEvery,
  scheduleEveryToMs,
  scheduleEveryLabel,
  type TickFrontmatter,
} from "@dashboard/lib/ticked/frontmatter";

describe("splitFrontmatter", () => {
  it("returns an empty frontmatter and the raw body when no block is present", () => {
    const { frontmatter, body } = splitFrontmatter("# Just a heading\n");
    expect(frontmatter).toEqual({});
    expect(body).toBe("# Just a heading\n");
  });

  it("parses every / disabled / worker and strips the block from the body", () => {
    const raw = "---\nevery: 1h\nworker: triage-bot\ndisabled: true\n---\nDo the thing\n";
    const { frontmatter, body } = splitFrontmatter(raw);
    expect(frontmatter).toEqual({
      every: "1h",
      worker: "triage-bot",
      disabled: true,
    });
    expect(body).toBe("Do the thing\n");
  });

  it("handles CRLF line endings", () => {
    const { frontmatter, body } = splitFrontmatter(
      "---\r\nevery: 30m\r\n---\r\nbody\r\n",
    );
    expect(frontmatter.every).toBe("30m");
    expect(body).toBe("body\r\n");
  });

  it("drops an invalid cadence token rather than guessing", () => {
    const { frontmatter } = splitFrontmatter("---\nevery: 45m\n---\nx");
    expect(frontmatter.every).toBeUndefined();
  });

  it("reads disabled case-insensitively and ignores non-boolean values", () => {
    expect(splitFrontmatter("---\ndisabled: TRUE\n---\nx").frontmatter.disabled).toBe(true);
    expect(splitFrontmatter("---\ndisabled: False\n---\nx").frontmatter.disabled).toBe(false);
    expect(splitFrontmatter("---\ndisabled: maybe\n---\nx").frontmatter.disabled).toBeUndefined();
  });

  it("ignores comments and unknown keys", () => {
    const { frontmatter } = splitFrontmatter(
      "---\n# a comment\nevery: 6h\nunknown: value\n---\nbody",
    );
    expect(frontmatter).toEqual({ every: "6h" });
  });

  it("strips surrounding quotes from values", () => {
    expect(splitFrontmatter("---\nworker: \"my-bot\"\n---\nx").frontmatter.worker).toBe("my-bot");
    expect(splitFrontmatter("---\nworker: 'my-bot'\n---\nx").frontmatter.worker).toBe("my-bot");
  });
});

describe("joinFrontmatter", () => {
  it("returns the body unchanged when there are no recognized fields (no empty block)", () => {
    expect(joinFrontmatter({}, "body text")).toBe("body text");
  });

  it("emits a block with fields in a stable order, omitting disabled:false", () => {
    const fm: TickFrontmatter = { every: "2h", worker: "bot", disabled: false };
    const out = joinFrontmatter(fm, "body");
    expect(out).toBe("---\nevery: 2h\nworker: bot\n---\n\nbody");
  });

  it("emits disabled:true explicitly", () => {
    expect(joinFrontmatter({ disabled: true }, "body")).toContain("disabled: true");
  });

  it("round-trips through splitFrontmatter", () => {
    const fm: TickFrontmatter = { every: "7d", worker: "weekly", disabled: true };
    const { frontmatter } = splitFrontmatter(joinFrontmatter(fm, "the body"));
    expect(frontmatter).toEqual(fm);
  });
});

describe("cadence helpers", () => {
  it("validates schedule tokens", () => {
    expect(isScheduleEvery("15m")).toBe(true);
    expect(isScheduleEvery("manual")).toBe(true);
    expect(isScheduleEvery("45m")).toBe(false);
    expect(isScheduleEvery(123)).toBe(false);
  });

  it("converts tokens to milliseconds, with manual = Infinity (never due)", () => {
    expect(scheduleEveryToMs("15m")).toBe(15 * 60 * 1000);
    expect(scheduleEveryToMs("1d")).toBe(24 * 60 * 60 * 1000);
    expect(scheduleEveryToMs("7d")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(scheduleEveryToMs("manual")).toBe(Number.POSITIVE_INFINITY);
  });

  it("labels every supported token", () => {
    expect(scheduleEveryLabel("1h")).toBe("every hour");
    expect(scheduleEveryLabel("manual")).toBe("manual only");
  });
});
