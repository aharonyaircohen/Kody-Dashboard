/**
 * Unit tests for the per-section "Suspend all" batch helper used by
 * FlyMachinesTable. The helper filters out non-running machines, runs the
 * suspend calls in parallel with bounded concurrency, and returns per-row
 * success / failure so the UI can toast partial-success and disable the
 * per-row actions in that group until the batch settles.
 *
 * Pure helper, no fetch / no React — so the seam is the injected
 * `suspendOne` function (same pattern as `suspendMachine` in
 * `fly-previews.spec.ts`).
 */
import { describe, expect, it, vi } from "vitest";

import {
  batchSuspendRunning,
  countRunningInGroup,
} from "@dashboard/lib/runners/fly-suspend-all";
import { isFlyMachineRunning } from "@dashboard/lib/runners/fly-machine-model";
import type { FlyMachineRow } from "@dashboard/lib/runners/fly-inventory";

function row(
  machineId: string,
  state: string,
  feature: FlyMachineRow["feature"] = "preview",
): FlyMachineRow {
  return {
    feature,
    app: feature === "preview" ? `kp-x-y-pr-${machineId}` : `kody-${feature}`,
    machineId,
    state,
    region: "fra",
    label: machineId,
    sizeLabel: "—",
  };
}

describe("isFlyMachineRunning", () => {
  it("treats running/started as running", () => {
    expect(isFlyMachineRunning("running")).toBe(true);
    expect(isFlyMachineRunning("started")).toBe(true);
  });

  it("treats suspended/stopped/destroyed as not running", () => {
    expect(isFlyMachineRunning("suspended")).toBe(false);
    expect(isFlyMachineRunning("stopped")).toBe(false);
    expect(isFlyMachineRunning("destroyed")).toBe(false);
  });
});

describe("countRunningInGroup", () => {
  it("counts only machines that are currently running", () => {
    const rows = [
      row("a", "started"),
      row("b", "started"),
      row("c", "suspended"),
      row("d", "stopped"),
    ];
    expect(countRunningInGroup(rows)).toBe(2);
  });
});

describe("batchSuspendRunning", () => {
  it("skips suspended / stopped / destroyed machines (no API call)", async () => {
    const suspend = vi.fn(async () => {});
    const rows = [
      row("a", "started"),
      row("b", "suspended"),
      row("c", "stopped"),
      row("d", "destroyed"),
    ];
    const { results } = await batchSuspendRunning(rows, suspend);
    expect(suspend).toHaveBeenCalledTimes(1);
    expect(suspend).toHaveBeenCalledWith(rows[0]);
    expect(results.map((r) => r.machineId)).toEqual(["a"]);
    expect(results[0]).toMatchObject({ ok: true });
  });

  it("runs the suspend calls in parallel with bounded concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const suspend = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      // Yield to the event loop so a second worker can start.
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
    });
    const rows = Array.from({ length: 12 }, (_, i) => row(`m${i}`, "started"));
    const { okCount } = await batchSuspendRunning(rows, suspend, 4);
    expect(okCount).toBe(12);
    expect(suspend).toHaveBeenCalledTimes(12);
    // Concurrency must not exceed the requested cap.
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("captures per-row failures without aborting the rest of the batch", async () => {
    const suspend = vi.fn(async (r: FlyMachineRow) => {
      if (r.machineId === "b") throw new Error("boom");
    });
    const rows = [
      row("a", "started"),
      row("b", "started"),
      row("c", "started"),
    ];
    const { results, okCount, failCount } = await batchSuspendRunning(
      rows,
      suspend,
    );
    expect(okCount).toBe(2);
    expect(failCount).toBe(1);
    const failed = results.find((r) => !r.ok)!;
    expect(failed.machineId).toBe("b");
    expect(failed.error).toBe("boom");
  });

  it("returns an empty result set when the group has no running machines", async () => {
    const suspend = vi.fn(async () => {});
    const rows = [row("a", "suspended"), row("b", "stopped")];
    const { results, okCount, failCount } = await batchSuspendRunning(
      rows,
      suspend,
    );
    expect(suspend).not.toHaveBeenCalled();
    expect(results).toEqual([]);
    expect(okCount).toBe(0);
    expect(failCount).toBe(0);
  });
});
