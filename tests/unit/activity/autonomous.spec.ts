/**
 * Unit tests for the Auto-feed builder: PRs + commits → newest-first actions.
 */
import { describe, it, expect } from "vitest";
import { buildAutonomousFeed } from "@dashboard/lib/activity/autonomous";
import type { RecentPR, RecentCommit } from "@dashboard/lib/github-client";

function pr(over: Partial<RecentPR>): RecentPR {
  return {
    number: 1,
    title: "t",
    state: "open",
    author: "kody",
    createdAt: "2026-05-23T10:00:00Z",
    mergedAt: null,
    closedAt: null,
    updatedAt: "2026-05-23T10:00:00Z",
    url: "u",
    ...over,
  };
}
function commit(over: Partial<RecentCommit>): RecentCommit {
  return { sha: "abcdef1234", message: "m", author: "kody", date: "2026-05-23T09:00:00Z", url: "u", ...over };
}

describe("buildAutonomousFeed", () => {
  it("emits opened + merged for a merged PR (two events at their own times)", () => {
    const out = buildAutonomousFeed(
      [pr({ number: 5, state: "merged", createdAt: "2026-05-23T08:00:00Z", mergedAt: "2026-05-23T12:00:00Z" })],
      [],
    );
    expect(out.map((e) => e.verb)).toEqual(["merged", "opened"]); // newest first
    expect(out.every((e) => e.ref === "#5")).toBe(true);
  });

  it("emits opened + closed for a closed (unmerged) PR", () => {
    const out = buildAutonomousFeed(
      [pr({ state: "closed", closedAt: "2026-05-23T11:00:00Z" })],
      [],
    );
    expect(out.map((e) => e.verb).sort()).toEqual(["closed", "opened"]);
  });

  it("emits only opened for an open PR", () => {
    const out = buildAutonomousFeed([pr({ state: "open" })], []);
    expect(out.map((e) => e.verb)).toEqual(["opened"]);
  });

  it("turns commits into pushed events", () => {
    const out = buildAutonomousFeed([], [commit({ sha: "deadbeef999", message: "fix things" })]);
    expect(out[0]).toMatchObject({ verb: "pushed", kind: "commit", ref: "deadbee", text: "fix things" });
  });

  it("merges PRs + commits sorted newest-first and respects the limit", () => {
    const out = buildAutonomousFeed(
      [pr({ number: 9, createdAt: "2026-05-23T07:00:00Z" })],
      [commit({ date: "2026-05-23T13:00:00Z" })],
      1,
    );
    expect(out).toHaveLength(1);
    expect(out[0].verb).toBe("pushed"); // 13:00 is newest
  });
});
