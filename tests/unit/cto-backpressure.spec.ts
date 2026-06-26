/**
 * Tests for the code-enforced pending-recommendation cap. The agentIdentity identities
 * are *told* to stop at 10 but count by hand and drift; this gate makes the
 * cap deterministic at the inbox-feed write point. The cap is applied **per
 * capability slug** so a chatty capability can't crowd other capabilities out of the queue. Pure
 * logic, so it's exhaustively tested here.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_PENDING_CTO_RECS,
  countPendingCtoRecs,
  countPendingByCapability,
  applyCtoBackpressure,
  ctoFeedKey,
} from "@dashboard/lib/cto/backpressure";
import {
  trustDecisionKey,
  type TrustLatestDecision,
} from "@dashboard/lib/cto/trust-state";
import type { InboxFeedEntry } from "@dashboard/lib/inbox/feed";

/** Helper: wrap a verdict with an ISO timestamp older than any test fixture. */
function decided(
  decision: TrustLatestDecision["decision"],
): TrustLatestDecision {
  return { decision, at: "2025-01-01T00:00:00.000Z" };
}

/** Helper: wrap a verdict with an ISO timestamp newer than any test fixture. */
function decidedFuture(
  decision: TrustLatestDecision["decision"],
): TrustLatestDecision {
  return { decision, at: "2099-01-01T00:00:00.000Z" };
}

const REPO = "acme/widgets";

function rec(
  taskNumber: number,
  action = "execute",
  capability = "cto",
): InboxFeedEntry {
  return {
    id: `aguyaharonyair:https://github.com/${REPO}/issues/${taskNumber}#c${taskNumber}`,
    login: "aguyaharonyair",
    source: "mention",
    repoFullName: REPO,
    threadType: "Issue",
    title: `Task ${taskNumber}`,
    snippet: "recommendation",
    url: `https://github.com/${REPO}/issues/${taskNumber}#issuecomment-${taskNumber}`,
    sentAt: new Date(2026, 0, 1, 0, taskNumber).toISOString(),
    ctoAction: action,
    ctoAgent: capability,
    ctoCapability: capability,
  };
}

/** CTO rec — keeps the original helper name for the unchanged-behaviour tests. */
function ctoRec(taskNumber: number, action = "execute"): InboxFeedEntry {
  return rec(taskNumber, action, "cto");
}

function plainMention(n: number): InboxFeedEntry {
  return {
    id: `aguyaharonyair:https://github.com/${REPO}/issues/${n}`,
    login: "aguyaharonyair",
    source: "mention",
    repoFullName: REPO,
    threadType: "Issue",
    title: `Mention ${n}`,
    snippet: "hey @aguyaharonyair",
    url: `https://github.com/${REPO}/issues/${n}`,
    sentAt: new Date(2026, 0, 2, 0, n).toISOString(),
  };
}

const NO_DECISIONS: Record<string, TrustLatestDecision> = {};

describe("ctoFeedKey", () => {
  it("resolves a rec entry to its capability+task+action", () => {
    expect(ctoFeedKey(rec(42, "fix", "qa"))).toEqual({
      capability: "qa",
      taskNumber: 42,
      action: "fix",
    });
  });

  it("falls back from capability to agent, then to the CTO slug", () => {
    const e = { ...ctoRec(42, "fix") };
    delete e.ctoCapability;
    expect(ctoFeedKey(e)).toEqual({
      capability: "cto",
      taskNumber: 42,
      action: "fix",
    });
    delete e.ctoAgent;
    expect(ctoFeedKey(e)).toEqual({
      capability: "cto",
      taskNumber: 42,
      action: "fix",
    });
  });

  it("returns null for a plain (non-rec) mention", () => {
    expect(ctoFeedKey(plainMention(7))).toBeNull();
  });

  it("returns null when the url has no issue number", () => {
    const e = { ...ctoRec(1), url: "https://github.com/acme/widgets" };
    expect(ctoFeedKey(e)).toBeNull();
  });
});

describe("countPendingCtoRecs / countPendingByCapability", () => {
  it("counts only undecided recs (total)", () => {
    const entries = [ctoRec(1), ctoRec(2), plainMention(3), ctoRec(4)];
    expect(countPendingCtoRecs(entries, NO_DECISIONS)).toBe(3);
  });

  it("buckets pending counts by capability slug", () => {
    const entries = [
      rec(1, "execute", "cto"),
      rec(2, "execute", "cto"),
      rec(3, "fix", "qa"),
      plainMention(4),
    ];
    const byCapability = countPendingByCapability(entries, NO_DECISIONS);
    expect(byCapability.get("cto")).toBe(2);
    expect(byCapability.get("qa")).toBe(1);
  });

  it("excludes recs whose verdict is newer than the rec (settles this rec)", () => {
    const decidedMap: Record<string, TrustLatestDecision> = {
      [trustDecisionKey("cto", 1, "execute")]: decidedFuture("approve"),
      [trustDecisionKey("cto", 4, "execute")]: decidedFuture("reject"),
    };
    const entries = [ctoRec(1), ctoRec(2), ctoRec(4)];
    expect(countPendingCtoRecs(entries, decidedMap)).toBe(1);
  });

  it("ignores stale verdicts that pre-date the rec (still pending)", () => {
    const stale: Record<string, TrustLatestDecision> = {
      [trustDecisionKey("cto", 1, "execute")]: decided("dismiss"),
    };
    expect(countPendingCtoRecs([ctoRec(1)], stale)).toBe(1);
  });

  it("a verdict for a DIFFERENT capability doesn't settle this rec", () => {
    // A future-dated verdict exists, but under the QA capability — the CTO's rec on
    // the same task+action must still count as pending.
    const decidedMap: Record<string, TrustLatestDecision> = {
      [trustDecisionKey("qa", 1, "execute")]: decidedFuture("approve"),
    };
    expect(countPendingCtoRecs([rec(1, "execute", "cto")], decidedMap)).toBe(1);
  });
});

describe("applyCtoBackpressure", () => {
  it("never gates plain mentions", () => {
    const current = Array.from({ length: 20 }, (_, i) => ctoRec(i + 1));
    const incoming = [plainMention(100), plainMention(101)];
    const { admitted, withheld } = applyCtoBackpressure(
      current,
      incoming,
      NO_DECISIONS,
    );
    expect(admitted).toHaveLength(2);
    expect(withheld).toHaveLength(0);
  });

  it("admits recs only up to that capability's headroom", () => {
    const current = Array.from({ length: 8 }, (_, i) => ctoRec(i + 1));
    const incoming = [ctoRec(101), ctoRec(102), ctoRec(103), ctoRec(104)];
    const { admitted, withheld } = applyCtoBackpressure(
      current,
      incoming,
      NO_DECISIONS,
    );
    expect(admitted).toHaveLength(2); // 10 - 8 pending (cto)
    expect(withheld).toHaveLength(2);
    expect(withheld.map((e) => ctoFeedKey(e)?.taskNumber)).toEqual([103, 104]);
  });

  it("withholds everything when that capability is already at the cap", () => {
    const current = Array.from({ length: MAX_PENDING_CTO_RECS }, (_, i) =>
      ctoRec(i + 1),
    );
    const { admitted, withheld } = applyCtoBackpressure(
      current,
      [ctoRec(200)],
      NO_DECISIONS,
    );
    expect(admitted).toHaveLength(0);
    expect(withheld).toHaveLength(1);
  });

  it("a full CTO queue does NOT block QA's recs (per-capability budgets)", () => {
    // CTO is at its cap; QA has an empty queue — QA's recs must still flow.
    const current = Array.from({ length: MAX_PENDING_CTO_RECS }, (_, i) =>
      rec(i + 1, "execute", "cto"),
    );
    const incoming = [
      rec(200, "execute", "cto"), // CTO — withheld (cap full)
      rec(201, "fix", "qa"), // QA — admitted (own budget)
      rec(202, "fix", "qa"), // QA — admitted
    ];
    const { admitted, withheld } = applyCtoBackpressure(
      current,
      incoming,
      NO_DECISIONS,
    );
    expect(admitted.map((e) => ctoFeedKey(e)?.capability)).toEqual(["qa", "qa"]);
    expect(withheld.map((e) => ctoFeedKey(e)?.capability)).toEqual(["cto"]);
  });

  it("frees a slot once the operator decides — the queue drains", () => {
    const current = Array.from({ length: MAX_PENDING_CTO_RECS }, (_, i) =>
      ctoRec(i + 1),
    );
    const decidedMap: Record<string, TrustLatestDecision> = {
      [trustDecisionKey("cto", 1, "execute")]: decidedFuture("approve"),
      [trustDecisionKey("cto", 2, "execute")]: decidedFuture("reject"),
    };
    const { admitted, withheld } = applyCtoBackpressure(
      current,
      [ctoRec(200), ctoRec(201), ctoRec(202)],
      decidedMap,
    );
    expect(admitted).toHaveLength(2); // two slots freed
    expect(withheld).toHaveLength(1);
  });

  it("a stale dismiss does NOT free a slot — fresh re-post still counts as pending", () => {
    const current = Array.from({ length: MAX_PENDING_CTO_RECS - 1 }, (_, i) =>
      ctoRec(i + 1),
    );
    const stale: Record<string, TrustLatestDecision> = {
      [trustDecisionKey("cto", 1, "execute")]: decided("dismiss"),
    };
    const { admitted, withheld } = applyCtoBackpressure(
      current,
      [ctoRec(200), ctoRec(201)],
      stale,
    );
    expect(admitted).toHaveLength(1);
    expect(withheld).toHaveLength(1);
  });

  it("lets mixed traffic through: mentions pass, recs gated per agent", () => {
    const current = Array.from({ length: 9 }, (_, i) => ctoRec(i + 1));
    const incoming = [
      plainMention(50),
      ctoRec(101),
      ctoRec(102),
      plainMention(51),
    ];
    const { admitted, withheld } = applyCtoBackpressure(
      current,
      incoming,
      NO_DECISIONS,
    );
    expect(admitted.map((e) => e.title)).toEqual([
      "Mention 50",
      "Task 101",
      "Mention 51",
    ]);
    expect(withheld.map((e) => e.title)).toEqual(["Task 102"]);
  });
});
