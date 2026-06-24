/**
 * Kody chat workflow summaries.
 */
import type { AgentResponsibilityEntry } from "./types";

export const DEFAULT_DUTY_KODY_ANALYZER: AgentResponsibilityEntry = {
  slug: "kody-analyzer",
  title: "kody-analyzer",
  body: `Read + propose workflows. Use when the user wants analysis, planning, or recommendation, not creation.

Skills:
- diagnose-pr — analyze a Kody PR and find gaps between claims and diff.
- report-advise — read a report and recommend create-issue / attach-to-mission / no-action.
- goal-planner — decompose a mission into concrete well-specced tasks.

Output shape: use agentIdentity's deep question shape: verdict, ### Findings, ### What's missing or risky.`,
};

export const DEFAULT_DUTY_KODY_OPERATOR: AgentResponsibilityEntry = {
  slug: "kody-operator",
  title: "kody-operator",
  body: `Create-on-demand workflows. Use when the user approved a plan and wants an artifact created.

Skills:
- create-issue — research -> gap-closing -> show body -> call matching create_* / report_bug.
- create-agentResponsibility — research -> gap-closing -> show profile/body -> call create_or_update_agent_responsibility.
- create-agent — research -> gap-closing -> show body -> call create_kody_agent.

Hard rules: never call create_* / report_bug on the first turn. Show title + body once approved, then call the tool. additionalContext must end with Research notes.`,
};

export const DEFAULT_DUTY_KODY_VIBE: AgentResponsibilityEntry = {
  slug: "kody-vibe",
  title: "kody-vibe",
  body: `Research -> plan -> create issue flow. Use inside Vibe workspace (vibeMode on).

Skills:
- vibe — issue-only Vibe flow: research extensively -> plan -> align -> create issue -> stop.

Override: in vibe, Kody chat does not dispatch runners, open branches, open draft PRs, or post @kody comments. Issue creation is the terminal action.`,
};

export const DEFAULT_DUTY_KODY_MEM: AgentResponsibilityEntry = {
  slug: "kody-mem",
  title: "kody-mem",
  body: `Persistent memory management. Use when the user gives feedback, corrects a choice, shares a project fact, or agentIdentity memory triggers fire.

Skills:
- memory — apply .kody/memory index, use recall / recall_search / list_memories when needed. Triggers: explicit memory command ("remember X", "store this", "save this later") -> remember; correction -> feedback; project fact -> project; user profile -> user; update_memory when a similar entry already exists.`,
};

export const DEFAULT_DUTIES = [
  DEFAULT_DUTY_KODY_ANALYZER,
  DEFAULT_DUTY_KODY_OPERATOR,
  DEFAULT_DUTY_KODY_VIBE,
  DEFAULT_DUTY_KODY_MEM,
];
