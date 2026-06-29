/**
 * @fileType library
 * @domain runner
 * @pattern fly-suspend-all
 * @ai-summary Per-section "Suspend all" batch helper used by
 *   `FlyMachinesTable`. Filters out non-running machines, runs the suspend
 *   calls in parallel with bounded concurrency (default 6 — chosen to stay
 *   well under Fly's per-token rate limit even with several sections batched
 *   in quick succession), and returns per-row success / failure so the UI
 *   can toast partial-success and disable the per-row actions in that group
 *   until the batch settles.
 *
 * The suspend call itself is injected so the React caller owns the HTTP
 * layer (it already speaks the auth headers + JSON shape of
 * `POST /api/kody/fly/machines/action`) and so this helper is testable
 * without a network.
 */
import type { FlyMachineRow } from "./fly-inventory";
import { isFlyMachineRunning } from "./fly-machine-model";

export interface SuspendResult {
  machineId: string;
  app: string;
  ok: boolean;
  error?: string;
}

export interface BatchSuspendResult {
  results: SuspendResult[];
  okCount: number;
  failCount: number;
}

/** How many of `rows` are currently running (i.e. a target for batch-suspend). */
export function countRunningInGroup(rows: FlyMachineRow[]): number {
  return rows.filter((r) => isFlyMachineRunning(r.state)).length;
}

/** Run `fn` over `items` with bounded concurrency. Mirrors `mapLimit` in
 *  `fly-inventory.ts` — kept private here to avoid widening that module's
 *  public surface. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return out;
}

/**
 * Suspend every running machine in `rows`, in parallel with bounded
 * concurrency. Suspended / stopped / destroyed machines are skipped — no
 * call to `suspendOne`. A failure on one row does not abort the rest of the
 * batch; the row is captured in `results` with `ok: false` and its error
 * message, so the UI can toast a partial-success summary.
 */
export async function batchSuspendRunning(
  rows: FlyMachineRow[],
  suspendOne: (row: FlyMachineRow) => Promise<void>,
  concurrency = 6,
): Promise<BatchSuspendResult> {
  const running = rows.filter((r) => isFlyMachineRunning(r.state));
  const results = await mapLimit(running, concurrency, async (row) => {
    try {
      await suspendOne(row);
      return { machineId: row.machineId, app: row.app, ok: true };
    } catch (err) {
      return {
        machineId: row.machineId,
        app: row.app,
        ok: false,
        error: (err as Error).message,
      };
    }
  });
  const okCount = results.filter((r) => r.ok).length;
  return { results, okCount, failCount: results.length - okCount };
}
