/**
 * Tests for the pure Activity snapshot fold — the signal math behind the
 * Engine Activity page. Locks in the queue-depth / flood / median logic
 * and the alert thresholds (tuned off the 984-comment loop incident).
 */
import { describe, expect, it } from "vitest";
import { buildActivitySnapshot } from "@dashboard/lib/activity/snapshot";
import type { WorkflowRun } from "@dashboard/lib/types";

const NOW = Date.parse("2026-05-17T12:00:00Z");

function run(over: Partial<WorkflowRun>): WorkflowRun {
  return {
    id: Math.floor(Math.random() * 1e9),
    status: "completed",
    conclusion: "success",
    created_at: new Date(NOW - 60_000).toISOString(),
    updated_at: new Date(NOW - 30_000).toISOString(),
    html_url: "https://github.com/o/r/actions/runs/1",
    display_title: "tick",
    head_branch: "main",
    ...over,
  };
}

describe("buildActivitySnapshot", () => {
  it("computes queue depth as queued + in_progress", () => {
    const snap = buildActivitySnapshot(
      [
        run({ status: "queued" }),
        run({ status: "queued" }),
        run({ status: "in_progress" }),
        run({ status: "completed", conclusion: "success" }),
      ],
      NOW,
    );
    expect(snap.signals.queueDepth).toBe(3);
    expect(snap.signals.queued).toBe(2);
    expect(snap.signals.inProgress).toBe(1);
  });

  it("counts runs created within the last 15 minutes", () => {
    const snap = buildActivitySnapshot(
      [
        run({ created_at: new Date(NOW - 5 * 60_000).toISOString() }),
        run({ created_at: new Date(NOW - 14 * 60_000).toISOString() }),
        run({ created_at: new Date(NOW - 20 * 60_000).toISOString() }),
      ],
      NOW,
    );
    expect(snap.signals.runsLast15m).toBe(2);
  });

  it("raises a critical alert on a flood", () => {
    const flood = Array.from({ length: 25 }, () =>
      run({ status: "queued", created_at: new Date(NOW).toISOString() }),
    );
    const snap = buildActivitySnapshot(flood, NOW);
    expect(snap.alert.level).toBe("critical");
    expect(snap.signals.queueDepth).toBe(25);
  });

  it("groups last-15m runs by trigger (names a loop)", () => {
    const at = new Date(NOW - 60_000).toISOString();
    const snap = buildActivitySnapshot(
      [
        ...Array.from({ length: 12 }, () =>
          run({ event: "issue_comment", created_at: at }),
        ),
        run({ event: "schedule", created_at: at }),
        run({
          event: "schedule",
          created_at: new Date(NOW - 30 * 60_000).toISOString(),
        }), // outside 15m window
      ],
      NOW,
    );
    expect(snap.signals.byTrigger).toEqual({
      issue_comment: 12,
      schedule: 1,
    });
    expect(snap.runs[0].trigger).toBeDefined();
  });

  it("excludes skipped/cancelled twins from the flood signal", () => {
    const at = new Date(NOW - 60_000).toISOString();
    const runs = [
      run({ conclusion: "success", created_at: at }),
      ...Array.from({ length: 18 }, () =>
        run({ conclusion: "skipped", created_at: at }),
      ),
      ...Array.from({ length: 6 }, () =>
        run({ conclusion: "cancelled", created_at: at }),
      ),
    ];
    const snap = buildActivitySnapshot(runs, NOW);
    expect(snap.signals.runsLast15m).toBe(1); // only the real run
    expect(snap.signals.noiseLast15m).toBe(24); // 18 skipped + 6 cancelled
    expect(snap.alert.level).toBe("ok"); // not a false "trigger loop"
    expect(snap.runs).toHaveLength(25); // all still visible in the list
  });

  it("stays ok when healthy", () => {
    const snap = buildActivitySnapshot(
      [
        run({ created_at: new Date(NOW - 30 * 60_000).toISOString() }),
        run({ created_at: new Date(NOW - 45 * 60_000).toISOString() }),
      ],
      NOW,
    );
    expect(snap.alert.level).toBe("ok");
  });

  it("medians completed durations and sorts newest first", () => {
    const snap = buildActivitySnapshot(
      [
        run({
          created_at: new Date(NOW - 600_000).toISOString(),
          updated_at: new Date(NOW - 480_000).toISOString(),
        }), // 120s, oldest
        run({
          created_at: new Date(NOW - 120_000).toISOString(),
          updated_at: new Date(NOW - 60_000).toISOString(),
        }), // 60s, newest
      ],
      NOW,
    );
    expect(snap.signals.medianDurationSec).toBe(90);
    expect(new Date(snap.runs[0].createdAt).getTime()).toBeGreaterThan(
      new Date(snap.runs[1].createdAt).getTime(),
    );
  });
});
