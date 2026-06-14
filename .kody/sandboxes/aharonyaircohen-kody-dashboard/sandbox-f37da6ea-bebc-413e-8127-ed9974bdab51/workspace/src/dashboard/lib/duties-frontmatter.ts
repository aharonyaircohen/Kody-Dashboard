/**
 * @fileType util
 * @domain kody
 * @pattern duties-frontmatter
 * @ai-summary Compatibility re-export for duty schedule helpers. Duties now
 *   store metadata in `profile.json`; older imports still use these cadence
 *   helpers and `DutyFrontmatter` types while the UI API shape stays stable.
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
