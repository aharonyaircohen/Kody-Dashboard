/**
 * Tests for the agentResponsibility-keyed trust ledger (`trust-state.ts`). Trust is whole-agentResponsibility
 * (one mode + streak per agentResponsibility slug, no action dimension). Contracts:
 *   - sibling agentResponsibilities of one agentIdentity stay independent;
 *   - approve bumps the streak and graduates at the threshold; reject zeroes +
 *     de-graduates; dismiss is neutral;
 *   - operator overrides (reset/graduate/degrade) are pure + immutable and work
 *     from scratch (graduate a agentResponsibility with no history);
 *   - parse/serialize round-trips plain JSON;
 *   - summarizeTrust emits one row per roster agentResponsibility (so its toggle is always
 *     present) even with zero history.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_TRUST_MANIFEST,
  TRUST_GRADUATION_THRESHOLD,
  applyTrustDecision,
  applyTrustOp,
  degradeAgentResponsibility,
  graduateAgentResponsibility,
  isGraduated,
  latestTrustDecisions,
  parseTrustManifest,
  resetAgentResponsibility,
  serializeTrustManifest,
  summarizeTrust,
  trustDecisionKey,
  type TrustManifest,
} from "@dashboard/lib/cto/trust-state";

function approvals(agentResponsibility: string, n: number): TrustManifest {
  let m: TrustManifest = structuredClone(EMPTY_TRUST_MANIFEST);
  for (let i = 0; i < n; i++) {
    m = applyTrustDecision(m, {
      agentResponsibility,
      decision: "approve",
      taskNumber: 100 + i,
    });
  }
  return m;
}

describe("applyTrustDecision — whole-agentResponsibility keying", () => {
  it("keeps sibling agentResponsibilities of the same agentIdentity independent", () => {
    const m = approvals("qa-sweep", 10);
    expect(isGraduated(m, "qa-sweep")).toBe(true);
    expect(isGraduated(m, "qa-verify")).toBe(false);
  });

  it("graduates at the threshold and de-graduates on a reject", () => {
    const m = approvals("qa", TRUST_GRADUATION_THRESHOLD);
    expect(m.agentResponsibilities.qa.mode).toBe("auto");
    const after = applyTrustDecision(m, {
      agentResponsibility: "qa",
      decision: "reject",
      taskNumber: 999,
    });
    expect(after.agentResponsibilities.qa.mode).toBe("ask");
    expect(after.agentResponsibilities.qa.consecutiveApprovals).toBe(0);
  });

  it("dismiss is neutral (logs, no stat change) and keeps the action for display", () => {
    const m = approvals("qa", 3);
    const after = applyTrustDecision(m, {
      agentResponsibility: "qa",
      decision: "dismiss",
      taskNumber: 7,
      action: "fix",
    });
    expect(after.agentResponsibilities.qa.consecutiveApprovals).toBe(3);
    expect(after.log.at(-1)?.action).toBe("fix");
  });
});

describe("operator overrides", () => {
  it("graduate forces auto from scratch (no prior history)", () => {
    const after = graduateAgentResponsibility(EMPTY_TRUST_MANIFEST, "qa-sweep");
    expect(after.agentResponsibilities["qa-sweep"].mode).toBe("auto");
    expect(after.agentResponsibilities["qa-sweep"].consecutiveApprovals).toBe(
      TRUST_GRADUATION_THRESHOLD,
    );
  });

  it("degrade resets to ask; reset wipes; input never mutated", () => {
    const grad = graduateAgentResponsibility(approvals("qa", 2), "qa");
    expect(degradeAgentResponsibility(grad, "qa").agentResponsibilities.qa.mode).toBe("ask");
    expect(resetAgentResponsibility(grad, "qa").agentResponsibilities.qa).toEqual({
      approvals: 0,
      rejections: 0,
      consecutiveApprovals: 0,
      mode: "ask",
    });
    const snap = structuredClone(grad);
    applyTrustOp(grad, "degrade", "qa");
    expect(grad).toEqual(snap);
  });
});

describe("parse/serialize", () => {
  it("round-trips a manifest and tolerates junk", () => {
    const m = graduateAgentResponsibility(approvals("qa", 1), "qa");
    expect(parseTrustManifest(serializeTrustManifest(m))).toEqual(m);
    expect(parseTrustManifest("not json")).toEqual(EMPTY_TRUST_MANIFEST);
    expect(parseTrustManifest(null)).toEqual(EMPTY_TRUST_MANIFEST);
  });
});

describe("latestTrustDecisions", () => {
  it("keys the latest verdict by agentResponsibility+task+action", () => {
    let m = applyTrustDecision(EMPTY_TRUST_MANIFEST, {
      agentResponsibility: "qa-verify",
      taskNumber: 1574,
      action: "sync",
      decision: "reject",
      at: "2026-01-01T00:00:00.000Z",
    });
    m = applyTrustDecision(m, {
      agentResponsibility: "qa-verify",
      taskNumber: 1574,
      action: "sync",
      decision: "approve",
      at: "2026-01-02T00:00:00.000Z",
    });

    expect(
      latestTrustDecisions(m)[trustDecisionKey("qa-verify", 1574, "sync")],
    ).toEqual({ decision: "approve", at: "2026-01-02T00:00:00.000Z" });
    expect(
      latestTrustDecisions(m)[trustDecisionKey("cto", 1574, "sync")],
    ).toBeUndefined();
  });
});

describe("summarizeTrust", () => {
  it("emits a row for every roster agentResponsibility even with no history (toggle always present)", () => {
    const views = summarizeTrust(EMPTY_TRUST_MANIFEST, [
      { slug: "qa-sweep", agent: "qa" },
      { slug: "docs-readme", agent: "tech-writer" },
    ]);
    expect(views).toHaveLength(2);
    const sweep = views.find((v) => v.agentResponsibility === "qa-sweep")!;
    expect(sweep.agent).toBe("qa");
    expect(sweep.mode).toBe("ask");
    expect(sweep.hasHistory).toBe(false);
  });

  it("computes remaining + progress toward the threshold", () => {
    const [qa] = summarizeTrust(approvals("qa", 4), [
      { slug: "qa", agent: "qa" },
    ]);
    expect(qa.remaining).toBe(TRUST_GRADUATION_THRESHOLD - 4);
    expect(qa.progress).toBeCloseTo(4 / TRUST_GRADUATION_THRESHOLD);
  });
});
