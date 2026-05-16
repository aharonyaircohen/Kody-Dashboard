/**
 * @fileType util
 * @domain kody
 * @pattern workers-schedule
 * @ai-summary Worker preset over the shared ticked-schedule helpers.
 *   Kind-agnostic; the one implementation lives in
 *   `ticked/schedule.ts`. Re-exported here so existing importers don't
 *   change.
 */

export {
  CRON_INTERVAL_MS,
  nextTickAt,
  formatDuration,
  formatRelativeFuture,
  formatRelativePast,
} from "./ticked/schedule";
