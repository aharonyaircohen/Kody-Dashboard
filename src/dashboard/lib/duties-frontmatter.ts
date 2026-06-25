/**
 * @fileType util
 * @domain kody
 * @pattern duties-frontmatter
 * @ai-summary Duty preset over the shared ticked-frontmatter parser.
 *   Duties and staff use the identical flat-YAML frontmatter format;
 *   the one implementation lives in `ticked/frontmatter.ts`. This file
 *   re-exports it under the `DutyFrontmatter` name so importers stay
 *   stable.
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
  TickFrontmatter as DutyFrontmatter,
} from "./ticked/frontmatter";
