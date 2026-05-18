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
import { ctoDecisionKey, type CtoDecision } from "@dashboard/lib/cto/decisions";
import type { InboxFeedEntry } from "@dashboard/lib/inbox/feed";

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

const NO_DECISIONS: Record<string, CtoDecision> = {};

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

  it("excludes recs that already have a ledger verdict", () => {
    const decided: Record<string, CtoDecision> = {
      [ctoDecisionKey(1, "execute")]: "approve",
      [ctoDecisionKey(4, "execute")]: "reject",
    };
    const entries = [ctoRec(1), ctoRec(2), ctoRec(4)];
    expect(countPendingCtoRecs(entries, decided)).toBe(1);
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
    const decided: Record<string, CtoDecision> = {
      [ctoDecisionKey(1, "execute")]: "approve",
      [ctoDecisionKey(2, "execute")]: "reject",
    };
    const { admitted, withheld } = applyCtoBackpressure(
      current,
      [ctoRec(200), ctoRec(201), ctoRec(202)],
      decided,
    );
    expect(admitted).toHaveLength(2); // two slots freed
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
