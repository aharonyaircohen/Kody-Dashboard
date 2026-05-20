/**
 * Tests for the code-enforced pending-CTO-recommendation cap. The cto.md
 * worker is *told* to stop at 10 but counts by hand and drifts; this gate
 * makes the cap deterministic at the inbox-feed write point. Pure logic,
 * so it's exhaustively tested here.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_PENDING_CTO_RECS,
  countPendingCtoRecs,
  applyCtoBackpressure,
  ctoFeedKey,
} from "@dashboard/lib/cto/backpressure";
import {
  ctoDecisionKey,
  type CtoLatestDecision,
} from "@dashboard/lib/cto/decisions";
import type { InboxFeedEntry } from "@dashboard/lib/inbox/feed";

/** Helper: wrap a verdict with an ISO timestamp older than any test fixture. */
function decided(decision: CtoLatestDecision["decision"]): CtoLatestDecision {
  return { decision, at: "2025-01-01T00:00:00.000Z" };
}

/** Helper: wrap a verdict with an ISO timestamp newer than any test fixture. */
function decidedFuture(
  decision: CtoLatestDecision["decision"],
): CtoLatestDecision {
  return { decision, at: "2099-01-01T00:00:00.000Z" };
}

const REPO = "acme/widgets";

function ctoRec(taskNumber: number, action = "execute"): InboxFeedEntry {
  return {
    id: `aguyaharonyair:https://github.com/${REPO}/issues/${taskNumber}#c${taskNumber}`,
    login: "aguyaharonyair",
    source: "mention",
    repoFullName: REPO,
    threadType: "Issue",
    title: `Task ${taskNumber}`,
    snippet: "CTO recommendation",
    url: `https://github.com/${REPO}/issues/${taskNumber}#issuecomment-${taskNumber}`,
    sentAt: new Date(2026, 0, 1, 0, taskNumber).toISOString(),
    ctoAction: action,
  };
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

const NO_DECISIONS: Record<string, CtoLatestDecision> = {};

describe("ctoFeedKey", () => {
  it("resolves a CTO rec entry to its task+action", () => {
    expect(ctoFeedKey(ctoRec(42, "fix"))).toEqual({
      taskNumber: 42,
      action: "fix",
    });
  });

  it("returns null for a plain (non-CTO) mention", () => {
    expect(ctoFeedKey(plainMention(7))).toBeNull();
  });

  it("returns null when the url has no issue number", () => {
    const e = { ...ctoRec(1), url: "https://github.com/acme/widgets" };
    expect(ctoFeedKey(e)).toBeNull();
  });
});

describe("countPendingCtoRecs", () => {
  it("counts only undecided CTO recs", () => {
    const entries = [ctoRec(1), ctoRec(2), plainMention(3), ctoRec(4)];
    expect(countPendingCtoRecs(entries, NO_DECISIONS)).toBe(3);
  });

  it("excludes recs whose verdict is newer than the rec (settles this rec)", () => {
    // Recs are minted with sentAt in early-2026; verdictFuture is 2099 so it
    // post-dates them — i.e. the operator settled THIS rec.
    const decidedMap: Record<string, CtoLatestDecision> = {
      [ctoDecisionKey(1, "execute")]: decidedFuture("approve"),
      [ctoDecisionKey(4, "execute")]: decidedFuture("reject"),
    };
    const entries = [ctoRec(1), ctoRec(2), ctoRec(4)];
    expect(countPendingCtoRecs(entries, decidedMap)).toBe(1);
  });

  it("ignores stale verdicts that pre-date the rec (still pending)", () => {
    // The verdict was recorded in 2025 — but the rec arrived in 2026.
    // That verdict belonged to an earlier rec for the same (task, action);
    // today's rec is fresh and must still count as pending.
    const stale: Record<string, CtoLatestDecision> = {
      [ctoDecisionKey(1, "execute")]: decided("dismiss"),
    };
    expect(countPendingCtoRecs([ctoRec(1)], stale)).toBe(1);
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

  it("admits CTO recs only up to the headroom", () => {
    const current = Array.from({ length: 8 }, (_, i) => ctoRec(i + 1));
    const incoming = [ctoRec(101), ctoRec(102), ctoRec(103), ctoRec(104)];
    const { admitted, withheld } = applyCtoBackpressure(
      current,
      incoming,
      NO_DECISIONS,
    );
    expect(admitted).toHaveLength(2); // 10 - 8 pending
    expect(withheld).toHaveLength(2);
    expect(withheld.map((e) => ctoFeedKey(e)?.taskNumber)).toEqual([103, 104]);
  });

  it("withholds everything when already at the cap", () => {
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

  it("frees a slot once the operator decides — the queue drains", () => {
    const current = Array.from({ length: MAX_PENDING_CTO_RECS }, (_, i) =>
      ctoRec(i + 1),
    );
    // Verdicts dated in the future relative to ctoRec's sentAt → bind to
    // the current recs and drain those two slots.
    const decidedMap: Record<string, CtoLatestDecision> = {
      [ctoDecisionKey(1, "execute")]: decidedFuture("approve"),
      [ctoDecisionKey(2, "execute")]: decidedFuture("reject"),
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
    // Operator dismissed an old sync rec on PR #1 yesterday; today the
    // pr-health job re-posted a fresh sync rec on PR #1. The new rec must
    // hold its slot until the operator decides AGAIN.
    const current = Array.from({ length: MAX_PENDING_CTO_RECS - 1 }, (_, i) =>
      ctoRec(i + 1),
    );
    const stale: Record<string, CtoLatestDecision> = {
      [ctoDecisionKey(1, "execute")]: decided("dismiss"),
    };
    const { admitted, withheld } = applyCtoBackpressure(
      current,
      [ctoRec(200), ctoRec(201)],
      stale,
    );
    // Only one headroom slot (9 pending in current, stale dismiss does
    // not free PR #1) → first new rec admitted, second withheld.
    expect(admitted).toHaveLength(1);
    expect(withheld).toHaveLength(1);
  });

  it("lets mixed traffic through: mentions pass, recs gated", () => {
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
