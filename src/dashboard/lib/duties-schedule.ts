/**
 * @fileType util
 * @domain kody
 * @pattern jobs-schedule
 * @ai-summary Job preset over the shared ticked-schedule helpers. The
 *   "next tick" math and relative-time formatting are kind-agnostic;
 *   the one implementation lives in `ticked/schedule.ts`. Re-exported
 *   here so existing importers don't change.
 */

export {
  CRON_INTERVAL_MS,
  nextTickAt,
  formatDuration,
  formatRelativeFuture,
  formatRelativePast,
} from "./ticked/schedule";
