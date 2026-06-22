/**
 * kody-analyzer — read/propose workflows. Skills: diagnose-pr, report-advise, goal-planner.
 */

import type { DutyEntry } from "./types";

export const DEFAULT_DUTY_KODY_ANALYZER: DutyEntry = {
  slug: "kody-analyzer",
  title: "kody-analyzer",
  body: `Read + propose workflows. Use these when the user wants analysis, planning, or a recommendation — not a creation.

**Skills:**
- \`diagnose-pr\` — analyze a Kody PR and find the gap between claims and diff
- \`report-advise\` — read a report and recommend create-issue / attach-to-mission / no-action
- \`goal-planner\` — decompose a mission into a concrete set of well-specced tasks (two passes, approval-gated; legacy slug)

**Output shape:** use the agentIdentity's "deep question" shape — verdict + \`### Findings\` + \`### What's missing or risky\` — for any of these workflows.`,
};

export const DEFAULT_DUTY_KODY_OPERATOR: DutyEntry = {
  slug: "kody-operator",
  title: "kody-operator",
  body: `Create-on-demand workflows. Use these when the user has approved a plan and wants the artifact created.

**Skills:**
- \`create-issue\` — research → gap-closing → show body → call the matching create_* / report_bug
- \`create-duty\` — research → gap-closing → show profile+body → call \`create_or_update_kody_duty\`
- \`create-agent\` — research → gap-closing → show body → call \`create_kody_agent\`

**Hard rules:** never call \`create_*\` / \`report_bug\` on the first turn. Show the title + body once for approval, then call the tool. \`additionalContext\` MUST end with **Research notes**.`,
};

export const DEFAULT_DUTY_KODY_VIBE: DutyEntry = {
  slug: "kody-vibe",
  title: "kody-vibe",
  body: `End-to-end research → plan → create → hand-off flow. Use this when running inside the Vibe workspace (\`vibeMode\` is on).

**Skills:**
- \`vibe\` — the 5-step Vibe flow (research extensively → plan → align → create issue → \`vibe_start_execution\` auto-handoff)

**Override:** in vibe, every base prompt rule about \`kody_run_issue\` / \`@kody\` / "the engine clones the repo" does NOT apply. Vibe dispatches to the Kody Live / Kody Live (Fly) runner via \`vibe_start_execution\`. One approval covers both create and start.`,
};

export const DEFAULT_DUTY_KODY_MEM: DutyEntry = {
  slug: "kody-mem",
  title: "kody-mem",
  body: `Persistent memory management. Use this when the user gives feedback, corrects a choice, shares a project fact, or the agentIdentity's memory triggers fire.

**Skills:**
- \`memory\` — apply the \`.kody/memory/\` index, use \`recall\` / \`recall_search\` / \`list_memories\` as needed, and \`remember\` / \`update_memory\` on every trigger

**Triggers (must \`remember\` in the same turn):** explicit memory command ("remember X", "store this", "save this for later") → choose type by content; correction → \`feedback\`; confirmation of non-obvious choice → \`feedback\`; project fact not in code/git → \`project\`; external pointer (Linear, Grafana) → \`reference\`; user profile → \`user\`.`,
};

export const DEFAULT_DUTIES = [
  DEFAULT_DUTY_KODY_ANALYZER,
  DEFAULT_DUTY_KODY_OPERATOR,
  DEFAULT_DUTY_KODY_VIBE,
  DEFAULT_DUTY_KODY_MEM,
];
