/**
 * Unit tests for the Fly machine-activity compute (pure) and the cost
 * estimate. Covers: running-interval summing (working time span), suspend
 * transition counting, uptime fraction, size pickup from the latest sized
 * sample, single-sample edge case, and cost monotonicity.
 */
import { describe, it, expect } from "vitest";
import {
  computeActivity,
  type FlyActivityFile,
} from "@dashboard/lib/runners/fly-activity";
import { estimateCost, hourlyCost } from "@dashboard/lib/runners/fly-rates";

const HOUR = 3_600_000;

function file(snapshots: FlyActivityFile["snapshots"]): FlyActivityFile {
  return { version: 1, snapshots };
}

const SIZE = { cpuKind: "shared", cpus: 2, memoryMb: 4096 };

describe("computeActivity", () => {
  it("sums running intervals as working time and counts suspends", () => {
    // t0 started, t0+1h started, t0+2h suspended, t0+3h started
    const t0 = 1_000_000_000_000;
    const m = (state: string) => ({
      app: "kp-x-y-pr-1",
      machineId: "m1",
      state,
      ...SIZE,
    });
    const [a] = computeActivity(
      file([
        { ts: t0, machines: [m("started")] },
        { ts: t0 + HOUR, machines: [m("started")] },
        { ts: t0 + 2 * HOUR, machines: [m("suspended")] },
        { ts: t0 + 3 * HOUR, machines: [m("started")] },
      ]),
    );
    // Running gaps: [t0,t0+1h] started, [t0+1h,t0+2h] started → 2h.
    // [t0+2h,t0+3h] suspended → not counted.
    expect(a.runningMs).toBe(2 * HOUR);
    // One running→suspended transition.
    expect(a.suspendCount).toBe(1);
    expect(a.spanMs).toBe(3 * HOUR);
    expect(a.uptime).toBeCloseTo(2 / 3, 5);
    expect(a.lastState).toBe("started");
    expect(a.samples).toBe(4);
  });

  it("treats a single sample as zero span / zero running (can't infer duration)", () => {
    const [a] = computeActivity(
      file([
        {
          ts: 5_000,
          machines: [
            { app: "kody-brain-alice", machineId: "z", state: "started", ...SIZE },
          ],
        },
      ]),
    );
    expect(a.spanMs).toBe(0);
    expect(a.runningMs).toBe(0);
    expect(a.uptime).toBe(0);
    expect(a.estCostUsd).toBe(0);
    expect(a.feature).toBe("brain");
  });

  it("picks size from the most recent sized sample", () => {
    const t0 = 2_000_000_000_000;
    const [a] = computeActivity(
      file([
        {
          ts: t0,
          machines: [{ app: "kody-runner", machineId: "r", state: "started" }],
        },
        {
          ts: t0 + HOUR,
          machines: [
            {
              app: "kody-runner",
              machineId: "r",
              state: "started",
              cpuKind: "performance",
              cpus: 2,
              memoryMb: 4096,
            },
          ],
        },
      ]),
    );
    expect(a.size.cpuKind).toBe("performance");
    expect(a.size.cpus).toBe(2);
  });

  it("sorts most expensive first", () => {
    const t0 = 3_000_000_000_000;
    const big = (i: number) => ({
      app: `kp-a-b-pr-${i}`,
      machineId: `big${i}`,
      state: "started",
      cpuKind: "shared",
      cpus: 4,
      memoryMb: 8192,
    });
    const small = (i: number) => ({
      app: `kp-a-b-pr-${i}`,
      machineId: `small${i}`,
      state: "started",
      cpuKind: "shared",
      cpus: 1,
      memoryMb: 256,
    });
    const rows = computeActivity(
      file([
        { ts: t0, machines: [small(1), big(2)] },
        { ts: t0 + 5 * HOUR, machines: [small(1), big(2)] },
      ]),
    );
    expect(rows[0].estCostUsd).toBeGreaterThanOrEqual(rows[1].estCostUsd);
  });
});

describe("estimateCost", () => {
  it("is zero for no running time and scales with hours", () => {
    expect(estimateCost(SIZE, 0)).toBe(0);
    const oneH = estimateCost(SIZE, HOUR);
    const twoH = estimateCost(SIZE, 2 * HOUR);
    expect(twoH).toBeCloseTo(2 * oneH, 6);
    expect(oneH).toBeCloseTo(hourlyCost(SIZE), 6);
  });

  it("charges performance CPUs more than shared", () => {
    const shared = hourlyCost({ cpuKind: "shared", cpus: 2, memoryMb: 2048 });
    const perf = hourlyCost({
      cpuKind: "performance",
      cpus: 2,
      memoryMb: 2048,
    });
    expect(perf).toBeGreaterThan(shared);
  });
});
