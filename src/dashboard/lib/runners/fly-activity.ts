/**
 * @fileType utility
 * @domain runner
 * @pattern fly-activity-compute
 * @ai-summary Derives per-machine Fly activity from snapshot timeline:
 *   uptime %, runningMs, suspendCount, estCostUsd. Fly exposes no uptime/cost
 *   API — we record our own periodic snapshots and compute everything here.
 *   Pure and deterministic (unit-testable); the route stamps `now` and feeds
 *   the stored file in.
 */

import { classifyApp, type FlyFeature } from "./fly-inventory";
import { estimateCost, type MachineSize } from "./fly-rates";

/** One machine's state at one snapshot moment. */
export interface ActivitySample extends MachineSize {
  app: string;
  machineId: string;
  state: string;
}

/** All machines captured at one moment. */
export interface ActivitySnapshot {
  ts: number;
  machines: ActivitySample[];
}

export interface FlyActivityFile {
  version: 1;
  snapshots: ActivitySnapshot[];
}

export const EMPTY_ACTIVITY_FILE: FlyActivityFile = {
  version: 1,
  snapshots: [],
};

/** Derived activity for a single machine across the retained window. */
export interface MachineActivity {
  app: string;
  machineId: string;
  feature: FlyFeature;
  label: string;
  /** First + last snapshot the machine appeared in (ms epoch). */
  firstSeen: number;
  lastSeen: number;
  /** Observed lifespan in the window (lastSeen − firstSeen). */
  spanMs: number;
  /** Working time span — summed intervals the machine was running. */
  runningMs: number;
  /** runningMs / spanMs as a 0–1 fraction (0 when span is 0). */
  uptime: number;
  /** Count of running → suspended/stopped transitions. */
  suspendCount: number;
  /** Most recent observed state. */
  lastState: string;
  size: MachineSize;
  /** Estimated USD over runningMs at the machine's size. */
  estCostUsd: number;
  /** Number of snapshots the machine appeared in. */
  samples: number;
}

/** Running = paying for CPU (not suspended/stopped/destroyed). */
function isRunning(state: string): boolean {
  return state !== "suspended" && state !== "stopped" && state !== "destroyed";
}

/**
 * Reduce the snapshot timeline to per-machine activity. Machines are keyed by
 * `app/machineId`. Between two consecutive snapshots, the machine is counted as
 * running for that gap if it was running at the earlier snapshot.
 */
export function computeActivity(file: FlyActivityFile): MachineActivity[] {
  const snapshots = [...(file.snapshots ?? [])].sort((a, b) => a.ts - b.ts);

  // machineKey → ordered list of { ts, sample }
  const series = new Map<string, Array<{ ts: number; s: ActivitySample }>>();
  for (const snap of snapshots) {
    for (const s of snap.machines) {
      const key = `${s.app}/${s.machineId}`;
      const arr = series.get(key) ?? [];
      arr.push({ ts: snap.ts, s });
      series.set(key, arr);
    }
  }

  const out: MachineActivity[] = [];
  for (const [, points] of series) {
    if (points.length === 0) continue;
    const first = points[0];
    const last = points[points.length - 1];
    const { feature, label } = classifyApp(first.s.app);

    let runningMs = 0;
    let suspendCount = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const cur = points[i];
      const nxt = points[i + 1];
      const gap = nxt.ts - cur.ts;
      if (gap > 0 && isRunning(cur.s.state)) runningMs += gap;
      if (isRunning(cur.s.state) && !isRunning(nxt.s.state)) suspendCount++;
    }

    // Size from the most recent sample that actually reported one.
    const sized =
      [...points].reverse().find((p) => p.s.cpus && p.s.cpus > 0)?.s ?? last.s;
    const size: MachineSize = {
      cpuKind: sized.cpuKind,
      cpus: sized.cpus,
      memoryMb: sized.memoryMb,
    };

    const spanMs = last.ts - first.ts;
    out.push({
      app: first.s.app,
      machineId: first.s.machineId,
      feature,
      label,
      firstSeen: first.ts,
      lastSeen: last.ts,
      spanMs,
      runningMs,
      uptime: spanMs > 0 ? runningMs / spanMs : 0,
      suspendCount,
      lastState: last.s.state,
      size,
      estCostUsd: estimateCost(size, runningMs),
      samples: points.length,
    });
  }

  // Most expensive first — that's what the operator wants to see.
  out.sort((a, b) => b.estCostUsd - a.estCostUsd);
  return out;
}
