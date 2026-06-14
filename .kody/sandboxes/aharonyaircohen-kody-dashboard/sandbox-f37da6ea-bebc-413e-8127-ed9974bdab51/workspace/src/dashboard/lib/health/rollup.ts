/**
 * @fileType utility
 * @domain kody
 * @pattern health-rollup
 * @ai-summary Pure helpers to combine many HealthSignals into one overall
 *   level and to order them worst-first for display. No I/O — unit-tested in
 *   isolation so the banner's severity logic can't silently drift.
 */
import type { HealthLevel, HealthSignal } from "./types";

const RANK: Record<HealthLevel, number> = { ok: 0, degraded: 1, down: 2 };

/** Worst level wins: `down` if any signal is down, else `degraded`, else `ok`. */
export function rollupLevel(signals: readonly HealthSignal[]): HealthLevel {
  let worst: HealthLevel = "ok";
  for (const s of signals) {
    if (RANK[s.level] > RANK[worst]) worst = s.level;
  }
  return worst;
}

/**
 * Sort signals worst-first (down → degraded → ok), preserving the original
 * order within a level (stable) so the banner reads predictably.
 */
export function orderSignals(signals: readonly HealthSignal[]): HealthSignal[] {
  return signals
    .map((s, i) => ({ s, i }))
    .sort((a, b) => RANK[b.s.level] - RANK[a.s.level] || a.i - b.i)
    .map(({ s }) => s);
}

/** Count signals by level — used for the banner's "2 down, 1 degraded" summary. */
export function countByLevel(
  signals: readonly HealthSignal[],
): Record<HealthLevel, number> {
  const out: Record<HealthLevel, number> = { ok: 0, degraded: 0, down: 0 };
  for (const s of signals) out[s.level]++;
  return out;
}
