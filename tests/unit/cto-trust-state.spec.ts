/**
 * Tests for the duty-keyed trust ledger (`trust-state.ts`) — the from-scratch
 * replacement for the persona-keyed issue manifest. Contracts:
 *   - trust is keyed per DUTY, so sibling duties of one persona are independent;
 *   - approve bumps the streak and graduates at the threshold; reject zeroes +
 *     de-graduates; dismiss is neutral;
 *   - operator overrides (reset/graduate/degrade) are pure + immutable;
 *   - parse/serialize round-trips plain JSON (no issue-body sentinels);
 *   - summarizeTrust groups by duty and attaches the persona it runs as.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_TRUST_MANIFEST,
  TRUST_GRADUATION_THRESHOLD,
  applyTrustDecision,
  applyTrustOp,
  degradeAction,
  graduateAction,
  isGraduated,
  parseTrustManifest,
  resetAction,
  serializeTrustManifest,
  summarizeTrust,
  type TrustManifest,
} from "@dashboard/lib/cto/trust-state";

function approvals(duty: string, action: string, n: number): TrustManifest {
  let m: TrustManifest = structuredClone(EMPTY_TRUST_MANIFEST);
  for (let i = 0; i < n; i++) {
    m = applyTrustDecision(m, {
      duty,
      action,
      decision: "approve",
      taskNumber: 100 + i,
    });
  }
  return m;
}

describe("applyTrustDecision — per-duty keying", () => {
  it("keeps sibling duties of the same persona independent", () => {
    // qa-sweep earns trust; qa-verify must NOT inherit it.
    const m = approvals("qa-sweep", "fix", 10);
    expect(isGraduated(m, "qa-sweep", "fix")).toBe(true);
    expect(isGraduated(m, "qa-verify", "fix")).toBe(false);
  });

  it("graduates at the threshold and de-graduates on a reject", () => {
    const m = approvals("qa", "fix", TRUST_GRADUATION_THRESHOLD);
    expect(m.duties.qa.fix.mode).toBe("auto");
    const after = applyTrustDecision(m, {
      duty: "qa",
      action: "fix",
      decision: "reject",
      taskNumber: 999,
    });
    expect(after.duties.qa.fix.mode).toBe("ask");
    expect(after.duties.qa.fix.consecutiveApprovals).toBe(0);
  });

  it("dismiss is neutral (logs, no stat change)", () => {
    const m = approvals("qa", "fix", 3);
    const after = applyTrustDecision(m, {
      duty: "qa",
      action: "fix",
      decision: "dismiss",
      taskNumber: 7,
    });
    expect(after.duties.qa.fix.consecutiveApprovals).toBe(3);
    expect(after.log.length).toBe(m.log.length + 1);
  });
});

describe("operator overrides", () => {
  it("graduate forces auto + lifts streak; degrade resets to ask; reset wipes", () => {
    const base = approvals("qa", "fix", 2);
    const grad = graduateAction(base, "qa", "fix");
    expect(grad.duties.qa.fix.mode).toBe("auto");
    expect(grad.duties.qa.fix.consecutiveApprovals).toBe(
      TRUST_GRADUATION_THRESHOLD,
    );
    expect(degradeAction(grad, "qa", "fix").duties.qa.fix.mode).toBe("ask");
    expect(resetAction(grad, "qa", "fix").duties.qa.fix).toEqual({
      approvals: 0,
      rejections: 0,
      consecutiveApprovals: 0,
      mode: "ask",
    });
  });

  it("does not mutate the input and routes via applyTrustOp", () => {
    const base = approvals("qa", "fix", 2);
    const snap = structuredClone(base);
    applyTrustOp(base, "graduate", "qa", "fix");
    expect(base).toEqual(snap);
  });
});

describe("parse/serialize", () => {
  it("round-trips a manifest and tolerates junk", () => {
    const m = graduateAction(approvals("qa", "fix", 1), "qa", "fix");
    expect(parseTrustManifest(serializeTrustManifest(m))).toEqual(m);
    expect(parseTrustManifest("not json")).toEqual(EMPTY_TRUST_MANIFEST);
    expect(parseTrustManifest(null)).toEqual(EMPTY_TRUST_MANIFEST);
  });
});

describe("summarizeTrust", () => {
  it("groups by duty and attaches the persona it runs as", () => {
    const m = graduateAction(approvals("qa-sweep", "fix", 1), "qa-sweep", "fix");
    const views = summarizeTrust(m, [
      { slug: "qa-sweep", staff: "qa" },
      { slug: "docs-readme", staff: "tech-writer" },
    ]);
    const sweep = views.find((v) => v.duty === "qa-sweep")!;
    expect(sweep.staff).toBe("qa");
    expect(sweep.hasAuto).toBe(true);
    // A roster duty with no trust still appears (empty actions).
    const docs = views.find((v) => v.duty === "docs-readme")!;
    expect(docs.actions).toHaveLength(0);
  });

  it("computes remaining + progress toward the threshold", () => {
    const [qa] = summarizeTrust(approvals("qa", "fix", 4), []);
    const fix = qa.actions.find((a) => a.action === "fix")!;
    expect(fix.remaining).toBe(TRUST_GRADUATION_THRESHOLD - 4);
    expect(fix.progress).toBeCloseTo(4 / TRUST_GRADUATION_THRESHOLD);
  });
});
