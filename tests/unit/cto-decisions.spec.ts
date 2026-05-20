/**
 * Tests for the CTO trust ledger's pure graduation logic
 * (`applyDecision`). This is the Phase 2 contract: N consecutive clean
 * approvals flip an action to "auto"; a single reject de-graduates it
 * (the kill switch). The math lives in code, not the LLM, so it's
 * deterministic and tested here.
 */
import { describe, expect, it } from "vitest";
import {
  applyDecision,
  latestCtoDecisions,
  ctoDecisionKey,
  parseCtoDecisionsBody,
  serializeCtoDecisionsBody,
  EMPTY_CTO_DECISIONS_MANIFEST,
  CTO_GRADUATION_THRESHOLD,
  type CtoDecisionsManifest,
} from "@dashboard/lib/cto/decisions";

function approveN(
  start: CtoDecisionsManifest,
  n: number,
  action = "execute",
): CtoDecisionsManifest {
  let m = start;
  for (let i = 0; i < n; i++) {
    m = applyDecision(m, { taskNumber: i + 1, action, decision: "approve" });
  }
  return m;
}

describe("applyDecision — graduation", () => {
  it("stays in 'ask' below the threshold", () => {
    const m = approveN(
      EMPTY_CTO_DECISIONS_MANIFEST,
      CTO_GRADUATION_THRESHOLD - 1,
    );
    const stats = m.actions.execute;
    expect(stats.consecutiveApprovals).toBe(CTO_GRADUATION_THRESHOLD - 1);
    expect(stats.mode).toBe("ask");
  });

  it("flips to 'auto' exactly at the threshold", () => {
    const m = approveN(EMPTY_CTO_DECISIONS_MANIFEST, CTO_GRADUATION_THRESHOLD);
    expect(m.actions.execute.mode).toBe("auto");
    expect(m.actions.execute.approvals).toBe(CTO_GRADUATION_THRESHOLD);
  });

  it("a single reject de-graduates back to 'ask' (kill switch)", () => {
    const graduated = approveN(
      EMPTY_CTO_DECISIONS_MANIFEST,
      CTO_GRADUATION_THRESHOLD,
    );
    expect(graduated.actions.execute.mode).toBe("auto");

    const killed = applyDecision(graduated, {
      taskNumber: 99,
      action: "execute",
      decision: "reject",
    });
    expect(killed.actions.execute.mode).toBe("ask");
    expect(killed.actions.execute.consecutiveApprovals).toBe(0);
    expect(killed.actions.execute.rejections).toBe(1);
    // Totals are preserved — graduation resets, history doesn't.
    expect(killed.actions.execute.approvals).toBe(CTO_GRADUATION_THRESHOLD);
  });

  it("must re-earn the full streak after a reject", () => {
    let m = approveN(EMPTY_CTO_DECISIONS_MANIFEST, CTO_GRADUATION_THRESHOLD);
    m = applyDecision(m, {
      taskNumber: 1,
      action: "execute",
      decision: "reject",
    });
    m = approveN(m, CTO_GRADUATION_THRESHOLD - 1);
    expect(m.actions.execute.mode).toBe("ask");
    m = approveN(m, 1);
    expect(m.actions.execute.mode).toBe("auto");
  });

  it("does not mutate the input manifest (immutability)", () => {
    const before = structuredClone(EMPTY_CTO_DECISIONS_MANIFEST);
    applyDecision(EMPTY_CTO_DECISIONS_MANIFEST, {
      taskNumber: 1,
      action: "execute",
      decision: "approve",
    });
    expect(EMPTY_CTO_DECISIONS_MANIFEST).toEqual(before);
  });

  it("dismiss leaves stats and graduation untouched", () => {
    const eight = approveN(EMPTY_CTO_DECISIONS_MANIFEST, 8);
    const after = applyDecision(eight, {
      taskNumber: 42,
      action: "execute",
      decision: "dismiss",
    });
    expect(after.actions.execute.approvals).toBe(8);
    expect(after.actions.execute.rejections).toBe(0);
    expect(after.actions.execute.consecutiveApprovals).toBe(8);
    expect(after.actions.execute.mode).toBe("ask");
    // Two more approvals should still graduate — dismiss didn't reset the streak.
    const graduated = approveN(after, 2);
    expect(graduated.actions.execute.mode).toBe("auto");
  });

  it("dismiss on a graduated action keeps it 'auto' (no kill-switch)", () => {
    const graduated = approveN(
      EMPTY_CTO_DECISIONS_MANIFEST,
      CTO_GRADUATION_THRESHOLD,
    );
    const after = applyDecision(graduated, {
      taskNumber: 7,
      action: "execute",
      decision: "dismiss",
    });
    expect(after.actions.execute.mode).toBe("auto");
    expect(after.actions.execute.consecutiveApprovals).toBe(
      CTO_GRADUATION_THRESHOLD,
    );
  });

  it("dismiss appends a log entry so the pending slot drains", () => {
    const after = applyDecision(EMPTY_CTO_DECISIONS_MANIFEST, {
      taskNumber: 99,
      action: "sync",
      decision: "dismiss",
    });
    expect(after.log).toHaveLength(1);
    expect(after.log[0]).toMatchObject({
      taskNumber: 99,
      action: "sync",
      decision: "dismiss",
    });
  });

  it("round-trips through serialize/parse", () => {
    const m = approveN(EMPTY_CTO_DECISIONS_MANIFEST, 3);
    const round = parseCtoDecisionsBody(serializeCtoDecisionsBody(m));
    expect(round.actions.execute).toEqual(m.actions.execute);
    expect(round.log).toHaveLength(3);
  });
});

describe("latestCtoDecisions — verdict + timestamp shape", () => {
  it("returns the latest verdict per (task, action) with its timestamp", () => {
    const at = "2026-05-20T10:47:32.000Z";
    const m = applyDecision(EMPTY_CTO_DECISIONS_MANIFEST, {
      taskNumber: 1574,
      action: "sync",
      decision: "dismiss",
      at,
    });
    const latest = latestCtoDecisions(m);
    expect(latest[ctoDecisionKey(1574, "sync")]).toEqual({
      decision: "dismiss",
      at,
    });
  });

  it("later log entries supersede earlier ones for the same key", () => {
    let m = applyDecision(EMPTY_CTO_DECISIONS_MANIFEST, {
      taskNumber: 1574,
      action: "sync",
      decision: "dismiss",
      at: "2026-05-20T10:47:32.000Z",
    });
    m = applyDecision(m, {
      taskNumber: 1574,
      action: "sync",
      decision: "approve",
      at: "2026-05-21T08:00:00.000Z",
    });
    expect(latestCtoDecisions(m)[ctoDecisionKey(1574, "sync")]).toEqual({
      decision: "approve",
      at: "2026-05-21T08:00:00.000Z",
    });
  });
});
