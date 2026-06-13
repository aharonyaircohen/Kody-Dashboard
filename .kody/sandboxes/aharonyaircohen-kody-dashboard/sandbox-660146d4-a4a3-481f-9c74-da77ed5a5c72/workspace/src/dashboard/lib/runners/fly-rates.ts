/**
 * @fileType utility
 * @domain runner
 * @pattern fly-cost-estimate
 * @ai-summary Approximate Fly Machines cost estimation from published list
 *   rates (÷730h). shared ~$0.0027/h, performance ~$0.0425/h, RAM ~$0.0069/GB/h.
 *   Fly has no per-machine cost API, only org-level billing. Estimates only —
 *   not a billing source of truth; good enough to flag expensive machines.
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
