/**
 * Unit tests for the Company Activity JSONL parser/normalizer.
 */
import { describe, it, expect } from "vitest";
import {
  latestActivityByAgentResponsibility,
  parseActivityJsonl,
  sortActivityNewestFirst,
} from "@dashboard/lib/activity/company";

describe("parseActivityJsonl", () => {
  it("parses well-formed records and skips blank/malformed lines", () => {
    const text = [
      JSON.stringify({
        ts: "2026-05-23T10:00:00Z",
        action: "Ran agentResponsibility: QA",
        agentResponsibility: "qa",
        agent: "qa-engineer",
        staffTitle: "QA Engineer",
        trigger: "schedule",
        outcome: "completed",
        durationMs: 1200,
        runUrl: "https://x/run/1",
      }),
      "",
      "{ not json",
      JSON.stringify({ ts: "2026-05-23T09:00:00Z", agentResponsibility: "sweep" }), // minimal
    ].join("\n");

    const out = parseActivityJsonl(text);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      agentResponsibility: "qa",
      agent: "qa-engineer",
      trigger: "schedule",
      outcome: "completed",
    });
    // Minimal record gets safe defaults.
    expect(out[1]).toMatchObject({
      agentResponsibility: "sweep",
      action: "Ran agentResponsibility: sweep",
      trigger: "event",
      outcome: "unknown",
      agent: null,
      durationMs: null,
    });
  });

  it("drops records missing ts or agentResponsibility", () => {
    const text = [
      JSON.stringify({ action: "x", agentResponsibility: "d" }), // no ts
      JSON.stringify({ ts: "2026-05-23T10:00:00Z" }), // no agentResponsibility
    ].join("\n");
    expect(parseActivityJsonl(text)).toHaveLength(0);
  });

  it("coerces unknown trigger/outcome to safe defaults", () => {
    const text = JSON.stringify({
      ts: "2026-05-23T10:00:00Z",
      agentResponsibility: "d",
      trigger: "weird",
      outcome: "bogus",
    });
    expect(parseActivityJsonl(text)[0]).toMatchObject({
      trigger: "event",
      outcome: "unknown",
    });
  });
});

describe("sortActivityNewestFirst", () => {
  it("orders by ts descending", () => {
    const recs = parseActivityJsonl(
      [
        JSON.stringify({ ts: "2026-05-23T08:00:00Z", agentResponsibility: "a" }),
        JSON.stringify({ ts: "2026-05-23T12:00:00Z", agentResponsibility: "b" }),
        JSON.stringify({ ts: "2026-05-23T10:00:00Z", agentResponsibility: "c" }),
      ].join("\n"),
    );
    expect(sortActivityNewestFirst(recs).map((r) => r.agentResponsibility)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });
});

describe("latestActivityByAgentResponsibility", () => {
  it("keeps the newest record per agentResponsibility", () => {
    const recs = parseActivityJsonl(
      [
        JSON.stringify({ ts: "2026-05-23T08:00:00Z", agentResponsibility: "docs" }),
        JSON.stringify({ ts: "2026-05-23T12:00:00Z", agentResponsibility: "qa" }),
        JSON.stringify({ ts: "2026-05-23T10:00:00Z", agentResponsibility: "docs" }),
      ].join("\n"),
    );
    const latest = latestActivityByAgentResponsibility(recs);
    expect(latest.get("docs")?.ts).toBe("2026-05-23T10:00:00Z");
    expect(latest.get("qa")?.ts).toBe("2026-05-23T12:00:00Z");
  });
});
