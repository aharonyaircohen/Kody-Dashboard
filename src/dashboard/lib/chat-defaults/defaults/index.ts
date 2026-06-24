/**
 * @fileType util
 * @domain kody
 * @pattern chat-defaults-bundle
 *
 * TS-embedded defaults for the Kody chat bundle. Re-exports the agentIdentity +
 * agentAction + agentResponsibilities + skills so consumers can `import { ... } from
 * "./defaults"`. Step 1 of the refactor: the chat composer's prompt is
 * sourced from these TS strings (verbatim copies of the previous
 * hardcoded `AGENT_KODY.systemPrompt` + mode blocks) so the structure
 * is testable without wiring the repo read.
 */

export type { AgentActionEntry, AgentResponsibilityEntry, SkillEntry } from "./types";
export { DEFAULT_EXECUTABLE } from "./agent-action";
export {
  DEFAULT_DUTIES,
  DEFAULT_DUTY_KODY_ANALYZER,
  DEFAULT_DUTY_KODY_OPERATOR,
  DEFAULT_DUTY_KODY_VIBE,
  DEFAULT_DUTY_KODY_MEM,
} from "./agent-responsibilities";
export {
  DEFAULT_SKILL_DIAGNOSE_PR,
  DEFAULT_SKILL_REPORT_ADVISE,
  DEFAULT_SKILL_GOAL_PLANNER,
} from "./skills-analyzer";
export {
  DEFAULT_SKILL_CREATE_ISSUE,
  DEFAULT_SKILL_CREATE_DUTY,
  DEFAULT_SKILL_CREATE_AGENT,
} from "./skills-operator";
export { DEFAULT_SKILL_VIBE } from "./skills-vibe";
export { DEFAULT_SKILL_MEMORY } from "./skills-mem";
export { DEFAULT_IDENTITY_MD } from "./agent";

import { DEFAULT_SKILL_DIAGNOSE_PR } from "./skills-analyzer";
import { DEFAULT_SKILL_REPORT_ADVISE } from "./skills-analyzer";
import { DEFAULT_SKILL_GOAL_PLANNER } from "./skills-analyzer";
import { DEFAULT_SKILL_CREATE_ISSUE } from "./skills-operator";
import { DEFAULT_SKILL_CREATE_DUTY } from "./skills-operator";
import { DEFAULT_SKILL_CREATE_AGENT } from "./skills-operator";
import { DEFAULT_SKILL_VIBE } from "./skills-vibe";
import { DEFAULT_SKILL_MEMORY } from "./skills-mem";
import type { SkillEntry } from "./types";

export const DEFAULT_SKILLS: Record<string, SkillEntry> = {
  [DEFAULT_SKILL_DIAGNOSE_PR.slug]: DEFAULT_SKILL_DIAGNOSE_PR,
  [DEFAULT_SKILL_REPORT_ADVISE.slug]: DEFAULT_SKILL_REPORT_ADVISE,
  [DEFAULT_SKILL_GOAL_PLANNER.slug]: DEFAULT_SKILL_GOAL_PLANNER,
  [DEFAULT_SKILL_CREATE_ISSUE.slug]: DEFAULT_SKILL_CREATE_ISSUE,
  [DEFAULT_SKILL_CREATE_DUTY.slug]: DEFAULT_SKILL_CREATE_DUTY,
  [DEFAULT_SKILL_CREATE_AGENT.slug]: DEFAULT_SKILL_CREATE_AGENT,
  [DEFAULT_SKILL_VIBE.slug]: DEFAULT_SKILL_VIBE,
  [DEFAULT_SKILL_MEMORY.slug]: DEFAULT_SKILL_MEMORY,
};
