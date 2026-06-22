/**
 * create-* skills — operator workflows.
 * Source: AGENT_KODY.systemPrompt § "Create issue / Create Kody duty / Create Kody agent".
 */

import type { SkillEntry } from "./types";

export const DEFAULT_SKILL_CREATE_ISSUE: SkillEntry = {
  slug: "create-issue",
  title: "create-issue",
  body: `If \`## Current task\` is present and the user is asking to fix / change / continue **that** issue (not a clearly separate piece of work), do NOT call \`create_*\` / \`report_bug\` — that creates a duplicate issue. Continue in the existing issue: research, agree on scope, then \`kody_run_issue({ issueNumber: <the Current task issue #> })\`. Only create a new issue if the request is unmistakably unrelated to the current task, and say so first. If that issue already has an open fix PR, refining the fix means applying your changes to that PR via \`kody_fix_pr({ prNumber, notes })\` — never tell the user to merge it first, and don't start a fresh \`kody_run_issue\`.

Never call \`create_*\` / \`report_bug\` on first turn.

1. Research (3–5 tool calls).
2. Ask gap-closing questions in batches of 1–3. Loop until scope, acceptance criteria, and out-of-scope are explicit.
3. Show title + body once for approval, then call the matching tool:
   - bug → \`report_bug\` · new capability → \`create_feature\` · improvement → \`create_enhancement\` · restructure → \`create_refactor\` · docs → \`create_documentation\` · deps/config → \`create_chore\`.
4. \`additionalContext\` MUST end with **Research notes**: 2–4 bullets, file:line evidence ("no matches" is valid). Paths in \`affectedArea\` and symbols in \`requirements\` MUST come from tool results this session.`,
};

export const DEFAULT_SKILL_CREATE_DUTY: SkillEntry = {
  slug: "create-duty",
  title: "create-duty",
  body: `\`.kody/duties/<slug>/\` is recurring work: \`profile.json\` holds action/cadence/agent/executable metadata and \`duty.md\` holds purpose, output, allowed commands, and restrictions. First call \`read_duty_creation_guide\`. Never first turn.

Sufficiency: purpose, agent, schedule, output, allowed commands, restrictions, plus concrete report inputs/schema when creating a report duty. Show the profile and body, then call \`create_or_update_kody_duty\` — the same tool handles both new duties and patches to an existing one (read-merge: omit a field to preserve it; pass \`body\` to replace the markdown; only call it after the user approves the diff).

**Key fields:** \`agent\` is the engine-aligned agentIdentity slug (the engine reads \`config.agent\`) \`executables\` (array) is for multi-run duties; \`executable\` (singular) is the convenience alias. \`output\` is the body mode: \`report\` (default, bakes the report-producer template with "Refresh .kody/reports/..." + report-specific restrictions) or \`run\` (generic Run-style body with NO report markers — required for multi-executable / dispatch-style duties because the engine appears to read body markers to route duties, and a Report body on a multi-run duty dispatches to the report-writer path instead of the normal task-job path). Auto-detected: \`executables\` with 2+ items defaults to \`run\`. \`profile\` (raw object) overrides any profile.json field the typed schema doesn't expose — use it for engine-specific keys, not as a substitute for the typed fields.`,
};

export const DEFAULT_SKILL_CREATE_AGENT: SkillEntry = {
  slug: "create-agent",
  title: "create-agent",
  body: `\`.kody/agents/<slug>.md\` — a pure reusable identity file (markdown body: intent, allowed commands, restrictions). Agents have no schedule, no state, no run/tick; they're agent identities referenced by other flows. Same gap loop and sufficiency bar as Create Kody duty. Show body, then call \`create_kody_agent\`.`,
};
