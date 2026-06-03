/**
 * @fileType utility
 * @domain runner
 * @pattern fly-cost-estimate
 *
 * Approximate Fly Machines pricing so the activity view can show an estimated
 * cost per machine. Fly has no per-machine cost API (only the org-level bill),
 * so we estimate from size × running time using published list rates.
 *
 * These are ESTIMATES — list price, fra region, RAM billed as "additional"
 * above the included base is folded into a flat per-GB rate. Good enough to
 * spot the expensive machines; not a billing source of truth.
 *
 * Rates derived from Fly's published monthly prices ÷ 730h:
 *   shared vCPU   ~$1.94/mo  → ~$0.002658/h
 *   performance   ~$31.00/mo → ~$0.042466/h
 *   RAM           ~$5.00/GB/mo → ~$0.006849/GB/h
 */

const SHARED_CPU_PER_HOUR = 1.94 / 730;
const PERF_CPU_PER_HOUR = 31.0 / 730;
const RAM_GB_PER_HOUR = 5.0 / 730;

export interface MachineSize {
  cpuKind?: string;
  cpus?: number;
  memoryMb?: number;
}

/** Estimated USD/hour for a machine of this size while it is running. */
export function hourlyCost(size: MachineSize): number {
  const cpus = size.cpus && size.cpus > 0 ? size.cpus : 1;
  const cpuRate =
    size.cpuKind === "performance" ? PERF_CPU_PER_HOUR : SHARED_CPU_PER_HOUR;
  const ramGb = (size.memoryMb ?? 0) / 1024;
  return cpus * cpuRate + ramGb * RAM_GB_PER_HOUR;
}

/** Estimated USD for `runningMs` of running time at this size. */
export function estimateCost(size: MachineSize, runningMs: number): number {
  if (runningMs <= 0) return 0;
  return hourlyCost(size) * (runningMs / 3_600_000);
}
