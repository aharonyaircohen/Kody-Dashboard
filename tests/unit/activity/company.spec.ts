/**
 * Unit tests for the Company Activity JSONL parser/normalizer.
 */
import { describe, it, expect } from "vitest";
import {
  latestActivityByCapability,
  parseActivityJsonl,
  sortActivityNewestFirst,
} from "@dashboard/lib/activity/company";

describe("parseActivityJsonl", () => {
  it("parses well-formed records and skips blank/malformed lines", () => {
    const text = [
      JSON.stringify({
        ts: "2026-05-23T10:00:00Z",
        action: "Ran capability: QA",
        capability: "qa",
        agent: "qa-engineer",
        staffTitle: "QA Engineer",
        trigger: "schedule",
        outcome: "completed",
        durationMs: 1200,
        runUrl: "https://x/run/1",
      }),
      "",
      "{ not json",
      JSON.stringify({ ts: "2026-05-23T09:00:00Z", capability: "sweep" }), // legacy minimal
    ].join("\n");

    const out = parseActivityJsonl(text);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      capability: "qa",
      agent: "qa-engineer",
      trigger: "schedule",
      outcome: "completed",
    });
    // Minimal record gets safe defaults.
    expect(out[1]).toMatchObject({
      capability: "sweep",
      action: "Ran capability: sweep",
      trigger: "event",
      outcome: "unknown",
      agent: null,
      durationMs: null,
    });
  });

  it("drops records missing ts or capability", () => {
    const text = [
      JSON.stringify({ action: "x", capability: "d" }), // no ts
      JSON.stringify({ ts: "2026-05-23T10:00:00Z" }), // no capability
    ].join("\n");
    expect(parseActivityJsonl(text)).toHaveLength(0);
  });

  it("coerces unknown trigger/outcome to safe defaults", () => {
    const text = JSON.stringify({
      ts: "2026-05-23T10:00:00Z",
      capability: "d",
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
        JSON.stringify({ ts: "2026-05-23T08:00:00Z", capability: "a" }),
        JSON.stringify({ ts: "2026-05-23T12:00:00Z", capability: "b" }),
        JSON.stringify({ ts: "2026-05-23T10:00:00Z", capability: "c" }),
      ].join("\n"),
    );
    expect(sortActivityNewestFirst(recs).map((r) => r.capability)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });
});

describe("latestActivityByCapability", () => {
  it("keeps the newest record per capability", () => {
    const recs = parseActivityJsonl(
      [
        JSON.stringify({ ts: "2026-05-23T08:00:00Z", capability: "docs" }),
        JSON.stringify({ ts: "2026-05-23T12:00:00Z", capability: "qa" }),
        JSON.stringify({ ts: "2026-05-23T10:00:00Z", capability: "docs" }),
      ].join("\n"),
    );
    const latest = latestActivityByCapability(recs);
    expect(latest.get("docs")?.ts).toBe("2026-05-23T10:00:00Z");
    expect(latest.get("qa")?.ts).toBe("2026-05-23T12:00:00Z");
  });
});
