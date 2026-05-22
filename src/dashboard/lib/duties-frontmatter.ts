/**
 * @fileType util
 * @domain kody
 * @pattern jobs-frontmatter
 * @ai-summary Job preset over the shared ticked-frontmatter parser.
 *   Jobs and workers use the identical flat-YAML frontmatter format;
 *   the one implementation lives in `ticked/frontmatter.ts`. This file
 *   re-exports it under the legacy `JobFrontmatter` name so existing
 *   importers don't change.
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
  TickFrontmatter as JobFrontmatter,
} from "./ticked/frontmatter";
