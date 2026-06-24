/**
 * @fileType util
 * @domain kody
 * @pattern agentResponsibilities-frontmatter
 * @ai-summary Compatibility re-export for agentResponsibility schedule helpers. AgentResponsibilities now
 *   store metadata in `profile.json`; older imports still use these cadence
 *   helpers and `AgentResponsibilityFrontmatter` types while the UI API shape stays stable.
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
  TickFrontmatter as AgentResponsibilityFrontmatter,
} from "./ticked/frontmatter";
