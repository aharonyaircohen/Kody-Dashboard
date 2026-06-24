/**
 * @fileType util
 * @domain kody
 * @pattern agentResponsibilities-schedule
 * @ai-summary AgentResponsibility preset over the shared ticked-schedule helpers. The
 *   "next tick" math and relative-time formatting are kind-agnostic;
 *   the one implementation lives in `ticked/schedule.ts`. Re-exported
 *   here so importers stay stable.
 */

export {
  CRON_INTERVAL_MS,
  nextTickAt,
  formatDuration,
  formatRelativeFuture,
  formatRelativePast,
} from "./ticked/schedule";
