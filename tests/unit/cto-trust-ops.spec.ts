/**
 * Tests for the /trust page's pure management ops over the staff trust ledger
 * (`reset`/`graduate`/`degrade`) and the `summarizeTrust` projection.
 *
 * These are operator OVERRIDES of autonomy, distinct from `applyDecision`
 * (which moves trust as a side effect of a single Approve/Reject). Contracts:
 *   - reset wipes stats to zero/"ask";
 *   - graduate forces "auto" AND lifts the streak to the threshold (so the
 *     engine, which graduates off `consecutiveApprovals`, doesn't undo it);
 *   - degrade forces "ask" + zero streak but keeps the totals;
 *   - every op is immutable (never touches the input manifest);
 *   - management ops never append to the decision `log`.
 */
import { describe, expect, it } from "vitest";
import {
  CTO_GRADUATION_THRESHOLD,
  EMPTY_CTO_DECISIONS_MANIFEST,
  applyDecision,
  type CtoDecisionsManifest,
} from "@dashboard/lib/cto/decisions";
import {
  applyTrustOp,
  degradeAction,
  graduateAction,
  resetAction,
  summarizeTrust,
} from "@dashboard/lib/cto/trust-ops";

/** Build a manifest with N consecutive approvals already banked for qa/fix. */
function withApprovals(n: number): CtoDecisionsManifest {
  let m: CtoDecisionsManifest = structuredClone(EMPTY_CTO_DECISIONS_MANIFEST);
  for (let i = 0; i < n; i++) {
    m = applyDecision(m, {
      staff: "qa",
      action: "fix",
      taskNumber: 100 + i,
      decision: "approve",
    });
  }
  return m;
}

describe("graduateAction", () => {
  it("forces auto and lifts the streak to the threshold", () => {
    const before = withApprovals(3);
    const after = graduateAction(before, "qa", "fix");
    expect(after.staff.qa.fix.mode).toBe("auto");
    expect(after.staff.qa.fix.consecutiveApprovals).toBe(
      CTO_GRADUATION_THRESHOLD,
    );
    // Totals preserved.
    expect(after.staff.qa.fix.approvals).toBe(3);
  });

  it("creates the action block when the staff/action is brand new", () => {
    const after = graduateAction(
      EMPTY_CTO_DECISIONS_MANIFEST,
      "coo",
      "execute",
    );
    expect(after.staff.coo.execute.mode).toBe("auto");
    expect(after.staff.coo.execute.consecutiveApprovals).toBe(
      CTO_GRADUATION_THRESHOLD,
    );
  });

  it("does not mutate the input manifest", () => {
    const before = withApprovals(3);
    const snapshot = structuredClone(before);
    graduateAction(before, "qa", "fix");
    expect(before).toEqual(snapshot);
  });
});

describe("degradeAction", () => {
  it("forces ask and zeroes the streak but keeps totals", () => {
    const before = graduateAction(withApprovals(11), "qa", "fix");
    const after = degradeAction(before, "qa", "fix");
    expect(after.staff.qa.fix.mode).toBe("ask");
    expect(after.staff.qa.fix.consecutiveApprovals).toBe(0);
    expect(after.staff.qa.fix.approvals).toBe(11);
  });
});

describe("resetAction", () => {
  it("wipes everything back to zero/ask", () => {
    const after = resetAction(withApprovals(5), "qa", "fix");
    expect(after.staff.qa.fix).toEqual({
      approvals: 0,
      rejections: 0,
      consecutiveApprovals: 0,
      mode: "ask",
    });
  });
});

describe("management ops never touch the decision log", () => {
  it("leaves the log untouched across all three ops", () => {
    const before = withApprovals(4);
    const logLen = before.log.length;
    expect(resetAction(before, "qa", "fix").log).toHaveLength(logLen);
    expect(graduateAction(before, "qa", "fix").log).toHaveLength(logLen);
    expect(degradeAction(before, "qa", "fix").log).toHaveLength(logLen);
  });
});

describe("applyTrustOp dispatch", () => {
  it("routes each op name to the right transform", () => {
    const base = withApprovals(2);
    expect(applyTrustOp(base, "graduate", "qa", "fix").staff.qa.fix.mode).toBe(
      "auto",
    );
    expect(
      applyTrustOp(base, "reset", "qa", "fix").staff.qa.fix
        .consecutiveApprovals,
    ).toBe(0);
    expect(applyTrustOp(base, "degrade", "qa", "fix").staff.qa.fix.mode).toBe(
      "ask",
    );
  });
});

describe("summarizeTrust", () => {
  it("groups actions under staff and attaches the duties that run as them", () => {
    const manifest = graduateAction(withApprovals(2), "qa", "fix");
    const views = summarizeTrust(manifest, [
      { slug: "qa-sweep", staff: "qa" },
      { slug: "qa-verify", staff: "qa" },
      { slug: "orphan", staff: null },
    ]);
    const qa = views.find((v) => v.staff === "qa");
    expect(qa).toBeTruthy();
    expect(qa!.duties).toEqual(["qa-sweep", "qa-verify"]);
    expect(qa!.actions[0]?.action).toBe("fix");
    expect(qa!.hasAuto).toBe(true);
  });

  it("includes a staff named only by a duty (no trust recorded yet)", () => {
    const views = summarizeTrust(EMPTY_CTO_DECISIONS_MANIFEST, [
      { slug: "docs-readme", staff: "tech-writer" },
    ]);
    const tw = views.find((v) => v.staff === "tech-writer");
    expect(tw).toBeTruthy();
    expect(tw!.actions).toHaveLength(0);
    expect(tw!.duties).toEqual(["docs-readme"]);
  });

  it("computes remaining + progress toward the threshold", () => {
    const manifest = withApprovals(4);
    const [qa] = summarizeTrust(manifest, []);
    const fix = qa.actions.find((a) => a.action === "fix")!;
    expect(fix.remaining).toBe(CTO_GRADUATION_THRESHOLD - 4);
    expect(fix.progress).toBeCloseTo(4 / CTO_GRADUATION_THRESHOLD);
  });
});
