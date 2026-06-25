/**
 * Unit tests for the legacy ticked-markdown frontmatter parser
 * (src/dashboard/lib/ticked/frontmatter.ts). Folder-backed agentResponsibilities use
 * profile.json; these helpers remain for markdown records and shared cadence
 * validation.
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

  it("parses every / disabled / agent and strips the block from the body", () => {
    const raw =
      "---\nevery: 1h\nagent: triage-bot\ndisabled: true\n---\nDo the thing\n";
    const { frontmatter, body } = splitFrontmatter(raw);
    expect(frontmatter).toEqual({
      every: "1h",
      agent: "triage-bot",
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

  it("ignores comments, unknown keys, and legacy agentResponsibility stage metadata", () => {
    const { frontmatter } = splitFrontmatter(
      "---\n# a comment\nevery: 6h\nstage: report-refresh\nunknown: value\n---\nbody",
    );
    expect(frontmatter).toEqual({ every: "6h" });
  });

  it("strips surrounding quotes from values", () => {
    expect(
      splitFrontmatter('---\nagent: "my-bot"\n---\nx').frontmatter.agent,
    ).toBe("my-bot");
    expect(
      splitFrontmatter("---\nagent: 'my-bot'\n---\nx").frontmatter.agent,
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

  it("parses multi-agentAction, agentResponsibility-tool, and scripted agentResponsibility fields", () => {
    const { frontmatter } = splitFrontmatter(
      [
        "---",
        "action: repo-graph",
        "agentAction: repo-graph-refresh",
        "agentActions: db-worker, api-worker, ui-worker",
        "tools: list_prs_to_repair, sync_pr",
        "tickScript: .kody/scripts/check-agentResponsibility.sh",
        "reads_from: company-graph, reports",
        "writes_to: ci-health-graph",
        "---",
        "body",
      ].join("\n"),
    );
    expect(frontmatter.action).toBe("repo-graph");
    expect(frontmatter.agentAction).toBe("repo-graph-refresh");
    expect(frontmatter.agentActions).toEqual([
      "db-worker",
      "api-worker",
      "ui-worker",
    ]);
    expect(frontmatter.agentResponsibilityTools).toEqual([
      "list_prs_to_repair",
      "sync_pr",
    ]);
    expect(frontmatter.tickScript).toBe(
      ".kody/scripts/check-agentResponsibility.sh",
    );
    expect(frontmatter.readsFrom).toEqual(["company-graph", "reports"]);
    expect(frontmatter.writesTo).toEqual(["ci-health-graph"]);
  });
});

describe("joinFrontmatter", () => {
  it("returns the body unchanged when there are no recognized fields (no empty block)", () => {
    expect(joinFrontmatter({}, "body text")).toBe("body text");
  });

  it("emits a block with fields in a stable order, omitting disabled:false", () => {
    const fm: TickFrontmatter = { every: "2h", agent: "bot", disabled: false };
    const out = joinFrontmatter(fm, "body");
    expect(out).toBe("---\nevery: 2h\nagent: bot\n---\n\nbody");
  });

  it("emits disabled:true explicitly", () => {
    expect(joinFrontmatter({ disabled: true }, "body")).toContain(
      "disabled: true",
    );
  });

  it("emits mentions as a comma-joined line after reviewer, no @", () => {
    const fm: TickFrontmatter = { agent: "bot", mentions: ["alice", "bob"] };
    expect(joinFrontmatter(fm, "body")).toBe(
      "---\nagent: bot\nmentions: alice, bob\n---\n\nbody",
    );
  });

  it("emits reviewer after agent and strips @", () => {
    const fm: TickFrontmatter = { agent: "bot", reviewer: "@qa" };
    expect(joinFrontmatter(fm, "body")).toBe(
      "---\nagent: bot\nreviewer: qa\n---\n\nbody",
    );
    expect(
      splitFrontmatter("---\nagent: bot\nreviewer: @qa\n---\nbody").frontmatter,
    ).toMatchObject({ agent: "bot", reviewer: "qa" });
  });

  it("reads agent but does not turn assignee into reviewer", () => {
    expect(
      splitFrontmatter("---\nagent: bot\nassignee: @qa\n---\nbody").frontmatter,
    ).toEqual({ agent: "bot" });
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
      agent: "weekly",
      disabled: true,
    };
    const { frontmatter } = splitFrontmatter(joinFrontmatter(fm, "the body"));
    expect(frontmatter).toEqual(fm);
  });

  it("round-trips mentions through splitFrontmatter", () => {
    const fm: TickFrontmatter = {
      every: "1d",
      agent: "weekly",
      mentions: ["alice", "bob"],
    };
    const { frontmatter } = splitFrontmatter(joinFrontmatter(fm, "the body"));
    expect(frontmatter).toEqual(fm);
  });

  it("emits the legacy agentResponsibility metadata shape in stable order", () => {
    const fm: TickFrontmatter = {
      action: "repo-graph",
      agentAction: "repo-graph-refresh",
      every: "1h",
      agent: "kody",
      reviewer: "qa",
      mentions: ["alice"],
      agentActions: ["db-worker", "api-worker"],
      agentResponsibilityTools: ["list_prs_to_repair", "sync_pr"],
      tickScript: ".kody/scripts/check-agentResponsibility.sh",
      readsFrom: ["company-graph", "reports"],
      writesTo: ["ci-health-graph"],
      disabled: true,
    };
    expect(joinFrontmatter(fm, "body")).toBe(
      [
        "---",
        "action: repo-graph",
        "agentAction: repo-graph-refresh",
        "every: 1h",
        "agent: kody",
        "reviewer: qa",
        "mentions: alice",
        "agentActions: db-worker, api-worker",
        "tools: list_prs_to_repair, sync_pr",
        "tickScript: .kody/scripts/check-agentResponsibility.sh",
        "reads_from: company-graph, reports",
        "writes_to: ci-health-graph",
        "disabled: true",
        "---",
        "",
        "body",
      ].join("\n"),
    );
  });

  it("omits empty new agentResponsibility arrays and null tick scripts", () => {
    expect(
      joinFrontmatter(
        {
          every: "1h",
          agentActions: [],
          agentResponsibilityTools: [],
          tickScript: null,
        },
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
