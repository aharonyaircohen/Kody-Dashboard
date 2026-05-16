/**
 * @fileType util
 * @domain kody
 * @pattern workers-frontmatter
 * @ai-summary Worker preset over the shared ticked-frontmatter parser.
 *   Identical format to jobs; the one implementation lives in
 *   `ticked/frontmatter.ts`. This file re-exports it under the legacy
 *   `WorkerFrontmatter` name so existing importers don't change.
 */

export {
  splitFrontmatter,
  joinFrontmatter,
  isScheduleEvery,
  ALL_SCHEDULE_EVERY_OPTIONS,
  scheduleEveryToMs,
  scheduleEveryLabel,
} from "./ticked/frontmatter";
export type {
  ScheduleEvery,
  TickFrontmatter as WorkerFrontmatter,
} from "./ticked/frontmatter";
