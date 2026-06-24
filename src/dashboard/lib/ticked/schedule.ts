/**
 * @fileType util
 * @domain kody
 * @pattern ticked-schedule
 * @ai-summary Helpers for rendering ticked-file schedule UI: "next
 *   scheduled tick" math (driven by the engine cron in
 *   templates/kody.yml — every 15 minutes) and relative-time formatting
 *   for "last ticked". Shared by agentResponsibilities and agent; `agentResponsibilities-schedule.ts`
 *   is a thin re-export shim over this module.
 *
 *   The engine cron is fixed at `*\/15 * * * *`. If that ever becomes
 *   per-repo configurable, expose CRON_INTERVAL_MS via the API instead
 *   of hard-coding here.
 */

/** Engine cron interval. Mirrors `*\/15 * * * *` in templates/kody.yml. */
export const CRON_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Compute the next cron wake at-or-after `from`. Returns an ISO8601
 * timestamp aligned to the next 15-minute boundary in UTC.
 */
export function nextTickAt(from: Date = new Date()): Date {
  const ms = from.getTime();
  const next = Math.ceil(ms / CRON_INTERVAL_MS) * CRON_INTERVAL_MS;
  // If `from` is exactly on a boundary, advance to the following one —
  // the cron has already fired this minute, so the next future wake is
  // 15 minutes away.
  return new Date(next === ms ? next + CRON_INTERVAL_MS : next);
}

/**
 * Format a positive duration in ms as a short human string:
 * "12s", "4m", "2h", "3d". Returns "now" for sub-second values.
 */
export function formatDuration(ms: number): string {
  const abs = Math.max(0, ms);
  if (abs < 1000) return "now";
  const sec = Math.round(abs / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h`;
  const day = Math.round(hr / 24);
  return `${day}d`;
}

/** "in 8m" / "in 2h" / "now" — for future timestamps. */
export function formatRelativeFuture(
  target: Date,
  now: Date = new Date(),
): string {
  const diff = target.getTime() - now.getTime();
  if (diff <= 0) return "now";
  return `in ${formatDuration(diff)}`;
}

/** "2m ago" / "3h ago" / "just now" — for past timestamps. */
export function formatRelativePast(
  target: Date,
  now: Date = new Date(),
): string {
  const diff = now.getTime() - target.getTime();
  if (diff < 1000) return "just now";
  return `${formatDuration(diff)} ago`;
}
