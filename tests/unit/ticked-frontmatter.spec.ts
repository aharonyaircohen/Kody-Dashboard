/**
 * Unit tests for the ticked-markdown frontmatter parser
 * (src/dashboard/lib/ticked/frontmatter.ts). Every duty/staff file's
 * schedule + staff binding is decoded here; a parse bug silently changes
 * whether (and as whom) a duty auto-fires. The persona-binding key on the
 * wire is `staff:` — that's what the engine reads (loadJobFromFile,
 * dispatchJobFileTicks). Pure logic.
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

  it("parses every / disabled / staff and strips the block from the body", () => {
    const raw =
      "---\nevery: 1h\nstaff: triage-bot\ndisabled: true\n---\nDo the thing\n";
    const { frontmatter, body } = splitFrontmatter(raw);
    expect(frontmatter).toEqual({
      every: "1h",
      staff: "triage-bot",
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
    expect(
      splitFrontmatter("---\ndisabled: TRUE\n---\nx").frontmatter.disabled,
    ).toBe(true);
    expect(
      splitFrontmatter("---\ndisabled: False\n---\nx").frontmatter.disabled,
    ).toBe(false);
    expect(
      splitFrontmatter("---\ndisabled: maybe\n---\nx").frontmatter.disabled,
    ).toBeUndefined();
  });

  it("ignores comments and unknown keys", () => {
    const { frontmatter } = splitFrontmatter(
      "---\n# a comment\nevery: 6h\nunknown: value\n---\nbody",
    );
    expect(frontmatter).toEqual({ every: "6h" });
  });

  it("strips surrounding quotes from values", () => {
    expect(
      splitFrontmatter('---\nstaff: "my-bot"\n---\nx').frontmatter.staff,
    ).toBe("my-bot");
    expect(
      splitFrontmatter("---\nstaff: 'my-bot'\n---\nx").frontmatter.staff,
    ).toBe("my-bot");
  });

  it("parses mentions as a comma-separated login list", () => {
    expect(
      splitFrontmatter("---\nmentions: aguyaharonyair, alice\n---\nx")
        .frontmatter.mentions,
    ).toEqual(["aguyaharonyair", "alice"]);
  });

  it("strips a leading @ and trims each mention", () => {
    expect(
      splitFrontmatter("---\nmentions: @alice ,  @bob\n---\nx").frontmatter
        .mentions,
    ).toEqual(["alice", "bob"]);
  });

  it("drops empty mention slots and omits the field when none remain", () => {
    expect(
      splitFrontmatter("---\nmentions: alice,, ,\n---\nx").frontmatter.mentions,
    ).toEqual(["alice"]);
    expect(
      splitFrontmatter("---\nmentions:   ,  \n---\nx").frontmatter.mentions,
    ).toBeUndefined();
  });

  it("parses multi-executable, duty-tool, and scripted duty fields", () => {
    const { frontmatter } = splitFrontmatter(
      [
        "---",
        "executables: db-worker, api-worker, ui-worker",
        "tools: list_prs_to_repair, sync_pr",
        "tickScript: .kody/scripts/check-duty.sh",
        "reads_from: company-graph, reports",
        "writes_to: ci-health-graph",
        "---",
        "body",
      ].join("\n"),
    );
    expect(frontmatter.executables).toEqual([
      "db-worker",
      "api-worker",
      "ui-worker",
    ]);
    expect(frontmatter.dutyTools).toEqual(["list_prs_to_repair", "sync_pr"]);
    expect(frontmatter.tickScript).toBe(".kody/scripts/check-duty.sh");
    expect(frontmatter.readsFrom).toEqual(["company-graph", "reports"]);
    expect(frontmatter.writesTo).toEqual(["ci-health-graph"]);
  });

  it("parses a valid duty stage template and drops unknown stages", () => {
    expect(
      splitFrontmatter("---\nstage: report-refresh\n---\nx").frontmatter.stage,
    ).toBe("report-refresh");
    expect(
      splitFrontmatter("---\nstage: make-it-so\n---\nx").frontmatter.stage,
    ).toBeUndefined();
  });
});

describe("joinFrontmatter", () => {
  it("returns the body unchanged when there are no recognized fields (no empty block)", () => {
    expect(joinFrontmatter({}, "body text")).toBe("body text");
  });

  it("emits a block with fields in a stable order, omitting disabled:false", () => {
    const fm: TickFrontmatter = { every: "2h", staff: "bot", disabled: false };
    const out = joinFrontmatter(fm, "body");
    expect(out).toBe("---\nevery: 2h\nstaff: bot\n---\n\nbody");
  });

  it("emits disabled:true explicitly", () => {
    expect(joinFrontmatter({ disabled: true }, "body")).toContain(
      "disabled: true",
    );
  });

  it("emits mentions as a comma-joined line after staff, no @", () => {
    const fm: TickFrontmatter = { staff: "bot", mentions: ["alice", "bob"] };
    expect(joinFrontmatter(fm, "body")).toBe(
      "---\nstaff: bot\nmentions: alice, bob\n---\n\nbody",
    );
  });

  it("omits the mentions line when the array is empty", () => {
    expect(joinFrontmatter({ mentions: [] }, "body")).toBe("body");
    expect(joinFrontmatter({ every: "1h", mentions: [] }, "body")).toBe(
      "---\nevery: 1h\n---\n\nbody",
    );
  });

  it("round-trips through splitFrontmatter", () => {
    const fm: TickFrontmatter = {
      every: "7d",
      staff: "weekly",
      disabled: true,
    };
    const { frontmatter } = splitFrontmatter(joinFrontmatter(fm, "the body"));
    expect(frontmatter).toEqual(fm);
  });

  it("round-trips mentions through splitFrontmatter", () => {
    const fm: TickFrontmatter = {
      every: "1d",
      staff: "weekly",
      mentions: ["alice", "bob"],
    };
    const { frontmatter } = splitFrontmatter(joinFrontmatter(fm, "the body"));
    expect(frontmatter).toEqual(fm);
  });

  it("emits the full engine duty frontmatter shape in stable order", () => {
    const fm: TickFrontmatter = {
      every: "1h",
      staff: "kody",
      stage: "sweep",
      mentions: ["alice"],
      executables: ["db-worker", "api-worker"],
      dutyTools: ["list_prs_to_repair", "sync_pr"],
      tickScript: ".kody/scripts/check-duty.sh",
      readsFrom: ["company-graph", "reports"],
      writesTo: ["ci-health-graph"],
      disabled: true,
    };
    expect(joinFrontmatter(fm, "body")).toBe(
      [
        "---",
        "every: 1h",
        "staff: kody",
        "stage: sweep",
        "mentions: alice",
        "executables: db-worker, api-worker",
        "tools: list_prs_to_repair, sync_pr",
        "tickScript: .kody/scripts/check-duty.sh",
        "reads_from: company-graph, reports",
        "writes_to: ci-health-graph",
        "disabled: true",
        "---",
        "",
        "body",
      ].join("\n"),
    );
  });

  it("omits empty new duty arrays and null tick scripts", () => {
    expect(
      joinFrontmatter(
        { every: "1h", executables: [], dutyTools: [], tickScript: null },
        "body",
      ),
    ).toBe("---\nevery: 1h\n---\n\nbody");
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
