/**
 * Tests for the staff trust ledger's pure graduation logic
 * (`applyDecision`). This is the Phase 2 contract: N consecutive clean
 * approvals flip an action to "auto"; a single reject de-graduates it
 * (the kill switch). The math lives in code, not the LLM, so it's
 * deterministic and tested here.
 *
 * The ledger is keyed per staff slug → action: each staff member earns and
 * loses autonomy on its own track record, never a shared pool. Legacy
 * (pre-staff) manifests + log entries migrate under the CTO slug.
 */
import { describe, expect, it } from "vitest";
import {
  applyDecision,
  latestCtoDecisions,
  staffDecisionKey,
  parseCtoDecisionsBody,
  serializeCtoDecisionsBody,
  EMPTY_CTO_DECISIONS_MANIFEST,
  DEFAULT_STAFF_SLUG,
  CTO_GRADUATION_THRESHOLD,
  type CtoDecisionsManifest,
} from "@dashboard/lib/cto/decisions";

function approveN(
  start: CtoDecisionsManifest,
  n: number,
  action = "execute",
  staff = DEFAULT_STAFF_SLUG,
): CtoDecisionsManifest {
  let m = start;
  for (let i = 0; i < n; i++) {
    m = applyDecision(m, {
      staff,
      taskNumber: i + 1,
      action,
      decision: "approve",
    });
  }
  return m;
}

/** Stats for the default (CTO) staff slice — most tests live under it. */
function ctoStats(m: CtoDecisionsManifest, action = "execute") {
  return m.staff[DEFAULT_STAFF_SLUG]?.[action];
}

describe("applyDecision — graduation", () => {
  it("stays in 'ask' below the threshold", () => {
    const m = approveN(
      EMPTY_CTO_DECISIONS_MANIFEST,
      CTO_GRADUATION_THRESHOLD - 1,
    );
    const stats = ctoStats(m)!;
    expect(stats.consecutiveApprovals).toBe(CTO_GRADUATION_THRESHOLD - 1);
    expect(stats.mode).toBe("ask");
  });

  it("flips to 'auto' exactly at the threshold", () => {
    const m = approveN(EMPTY_CTO_DECISIONS_MANIFEST, CTO_GRADUATION_THRESHOLD);
    expect(ctoStats(m)!.mode).toBe("auto");
    expect(ctoStats(m)!.approvals).toBe(CTO_GRADUATION_THRESHOLD);
  });

  it("a single reject de-graduates back to 'ask' (kill switch)", () => {
    const graduated = approveN(
      EMPTY_CTO_DECISIONS_MANIFEST,
      CTO_GRADUATION_THRESHOLD,
    );
    expect(ctoStats(graduated)!.mode).toBe("auto");

    const killed = applyDecision(graduated, {
      staff: DEFAULT_STAFF_SLUG,
      taskNumber: 99,
      action: "execute",
      decision: "reject",
    });
    expect(ctoStats(killed)!.mode).toBe("ask");
    expect(ctoStats(killed)!.consecutiveApprovals).toBe(0);
    expect(ctoStats(killed)!.rejections).toBe(1);
    // Totals are preserved — graduation resets, history doesn't.
    expect(ctoStats(killed)!.approvals).toBe(CTO_GRADUATION_THRESHOLD);
  });

  it("must re-earn the full streak after a reject", () => {
    let m = approveN(EMPTY_CTO_DECISIONS_MANIFEST, CTO_GRADUATION_THRESHOLD);
    m = applyDecision(m, {
      staff: DEFAULT_STAFF_SLUG,
      taskNumber: 1,
      action: "execute",
      decision: "reject",
    });
    m = approveN(m, CTO_GRADUATION_THRESHOLD - 1);
    expect(ctoStats(m)!.mode).toBe("ask");
    m = approveN(m, 1);
    expect(ctoStats(m)!.mode).toBe("auto");
  });

  it("defaults the staff slug to the CTO when the caller omits it", () => {
    const m = applyDecision(EMPTY_CTO_DECISIONS_MANIFEST, {
      taskNumber: 1,
      action: "execute",
      decision: "approve",
    });
    expect(m.staff[DEFAULT_STAFF_SLUG].execute.approvals).toBe(1);
    expect(m.log[0].staff).toBe(DEFAULT_STAFF_SLUG);
  });

  it("does not mutate the input manifest (immutability)", () => {
    const before = structuredClone(EMPTY_CTO_DECISIONS_MANIFEST);
    applyDecision(EMPTY_CTO_DECISIONS_MANIFEST, {
      staff: DEFAULT_STAFF_SLUG,
      taskNumber: 1,
      action: "execute",
      decision: "approve",
    });
    expect(EMPTY_CTO_DECISIONS_MANIFEST).toEqual(before);
  });

  it("dismiss leaves stats and graduation untouched", () => {
    const eight = approveN(EMPTY_CTO_DECISIONS_MANIFEST, 8);
    const after = applyDecision(eight, {
      staff: DEFAULT_STAFF_SLUG,
      taskNumber: 42,
      action: "execute",
      decision: "dismiss",
    });
    expect(ctoStats(after)!.approvals).toBe(8);
    expect(ctoStats(after)!.rejections).toBe(0);
    expect(ctoStats(after)!.consecutiveApprovals).toBe(8);
    expect(ctoStats(after)!.mode).toBe("ask");
    // Two more approvals should still graduate — dismiss didn't reset the streak.
    const graduated = approveN(after, 2);
    expect(ctoStats(graduated)!.mode).toBe("auto");
  });

  it("dismiss on a graduated action keeps it 'auto' (no kill-switch)", () => {
    const graduated = approveN(
      EMPTY_CTO_DECISIONS_MANIFEST,
      CTO_GRADUATION_THRESHOLD,
    );
    const after = applyDecision(graduated, {
      staff: DEFAULT_STAFF_SLUG,
      taskNumber: 7,
      action: "execute",
      decision: "dismiss",
    });
    expect(ctoStats(after)!.mode).toBe("auto");
    expect(ctoStats(after)!.consecutiveApprovals).toBe(
      CTO_GRADUATION_THRESHOLD,
    );
  });

  it("dismiss appends a log entry so the pending slot drains", () => {
    const after = applyDecision(EMPTY_CTO_DECISIONS_MANIFEST, {
      staff: DEFAULT_STAFF_SLUG,
      taskNumber: 99,
      action: "sync",
      decision: "dismiss",
    });
    expect(after.log).toHaveLength(1);
    expect(after.log[0]).toMatchObject({
      staff: DEFAULT_STAFF_SLUG,
      taskNumber: 99,
      action: "sync",
      decision: "dismiss",
    });
  });

  it("round-trips through serialize/parse", () => {
    const m = approveN(EMPTY_CTO_DECISIONS_MANIFEST, 3);
    const round = parseCtoDecisionsBody(serializeCtoDecisionsBody(m));
    expect(ctoStats(round)).toEqual(ctoStats(m));
    expect(round.log).toHaveLength(3);
  });
});

describe("applyDecision — per-staff isolation", () => {
  it("keeps each staff member's trust on the same action independent", () => {
    // CTO graduates `execute`; QA must NOT inherit autonomy on its own `execute`.
    let m = approveN(
      EMPTY_CTO_DECISIONS_MANIFEST,
      CTO_GRADUATION_THRESHOLD,
      "execute",
      "cto",
    );
    expect(m.staff.cto.execute.mode).toBe("auto");
    expect(m.staff.qa).toBeUndefined();

    // One QA approval — QA's `execute` is brand new, still "ask".
    m = applyDecision(m, {
      staff: "qa",
      taskNumber: 1,
      action: "execute",
      decision: "approve",
    });
    expect(m.staff.qa.execute.mode).toBe("ask");
    expect(m.staff.qa.execute.consecutiveApprovals).toBe(1);
    // CTO's graduation is untouched by QA's activity.
    expect(m.staff.cto.execute.mode).toBe("auto");
  });

  it("a reject against one staff member doesn't de-graduate another", () => {
    let m = approveN(
      EMPTY_CTO_DECISIONS_MANIFEST,
      CTO_GRADUATION_THRESHOLD,
      "execute",
      "cto",
    );
    m = approveN(m, CTO_GRADUATION_THRESHOLD, "execute", "qa");
    expect(m.staff.cto.execute.mode).toBe("auto");
    expect(m.staff.qa.execute.mode).toBe("auto");

    // Reject QA → QA back to ask, CTO still auto.
    m = applyDecision(m, {
      staff: "qa",
      taskNumber: 1,
      action: "execute",
      decision: "reject",
    });
    expect(m.staff.qa.execute.mode).toBe("ask");
    expect(m.staff.cto.execute.mode).toBe("auto");
  });
});

describe("parseCtoDecisionsBody — legacy migration", () => {
  it("migrates a flat pre-staff `actions` map under the CTO slug", () => {
    const legacy = serializeLegacy({
      version: 1,
      actions: {
        execute: {
          approvals: 5,
          rejections: 0,
          consecutiveApprovals: 5,
          mode: "ask",
        },
      },
      log: [
        {
          taskNumber: 7,
          action: "execute",
          decision: "approve",
          at: "2026-05-01T00:00:00.000Z",
        },
      ],
    });
    const m = parseCtoDecisionsBody(legacy);
    expect(m.staff.cto.execute.approvals).toBe(5);
    // Legacy log entry gets stamped as the CTO's.
    expect(m.log[0].staff).toBe("cto");
  });
});

describe("latestCtoDecisions — verdict + timestamp shape", () => {
  it("returns the latest verdict per (staff, task, action) with its timestamp", () => {
    const at = "2026-05-20T10:47:32.000Z";
    const m = applyDecision(EMPTY_CTO_DECISIONS_MANIFEST, {
      staff: "qa",
      taskNumber: 1574,
      action: "sync",
      decision: "dismiss",
      at,
    });
    const latest = latestCtoDecisions(m);
    expect(latest[staffDecisionKey("qa", 1574, "sync")]).toEqual({
      decision: "dismiss",
      at,
    });
    // Not stored under the CTO slug — staff scoping holds.
    expect(latest[staffDecisionKey("cto", 1574, "sync")]).toBeUndefined();
  });

  it("later log entries supersede earlier ones for the same key", () => {
    let m = applyDecision(EMPTY_CTO_DECISIONS_MANIFEST, {
      staff: DEFAULT_STAFF_SLUG,
      taskNumber: 1574,
      action: "sync",
      decision: "dismiss",
      at: "2026-05-20T10:47:32.000Z",
    });
    m = applyDecision(m, {
      staff: DEFAULT_STAFF_SLUG,
      taskNumber: 1574,
      action: "sync",
      decision: "approve",
      at: "2026-05-21T08:00:00.000Z",
    });
    expect(
      latestCtoDecisions(m)[staffDecisionKey(DEFAULT_STAFF_SLUG, 1574, "sync")],
    ).toEqual({
      decision: "approve",
      at: "2026-05-21T08:00:00.000Z",
    });
  });
});

/** Build a manifest issue body in the pre-staff (flat `actions`) shape. */
function serializeLegacy(manifest: unknown): string {
  const json = JSON.stringify(manifest, null, 2);
  return `<!-- kody-cto-decisions:start -->\n\n\`\`\`json\n${json}\n\`\`\`\n\n<!-- kody-cto-decisions:end -->\n`;
}
