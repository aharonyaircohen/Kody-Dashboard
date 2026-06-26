/**
 * create-* skills — operator workflows.
 * Source: AGENT_KODY.systemPrompt § "Create issue / Create Kody capability / Create Kody agent".
 */

import type { SkillEntry } from "./types";

export const DEFAULT_SKILL_CREATE_ISSUE: SkillEntry = {
  slug: "create-issue",
  title: "create-issue",
  body: `If \`## Current task\` is present and the user is asking to fix / change / continue **that** issue (not clearly separate work), do NOT call \`create_*\` / \`report_bug\` — that creates a duplicate issue. Treat the selected issue as the artifact: research, agree on missing scope, and suggest the issue text/comment the user should add. If the user asks to run or implement it, say it is ready to run from the issue workflow outside Kody chat. Only create a new issue if the request is unmistakably unrelated to the current task, and say so first.

Never call \`create_*\` / \`report_bug\` on first turn.

1. Research (3–5 tool calls).
2. Ask gap-closing questions in batches of 1–3. Loop until scope, acceptance criteria, and out-of-scope are explicit.
3. Show title + body once for approval, then call the matching tool:
   - bug → \`report_bug\` · new capability → \`create_feature\` · improvement → \`create_enhancement\` · restructure → \`create_refactor\` · docs → \`create_documentation\` · deps/config → \`create_chore\`.
4. \`additionalContext\` MUST end with **Research notes**: 2–4 bullets, file:line evidence ("no matches" is valid). Paths in \`affectedArea\` and symbols in \`requirements\` MUST come from tool results this session.`,
};

export const DEFAULT_SKILL_CREATE_DUTY: SkillEntry = {
  slug: "create-capability",
  title: "create-capability",
  body: `State-repo \`capabilities/<slug>/\` is a callable agency capability: \`profile.json\` holds execution settings and \`capability.md\` holds the instructions. First call \`read_capability_creation_guide\`. Never first turn.

Sufficiency: name, kind, clear instructions, landing, needed tools, optional skills, and optional scripts. Capabilities produce the result; the owning agent/goal/loop decides when and why to run them. Show the profile and instructions, then call \`create_or_update_capability\` only after the user approves.

**Key fields:** \`slug\` is the capability name, \`capabilityKind\` is observe/act/verify, \`instructions\` become \`capability.md\`, and \`landing\` controls whether the result opens a PR or comments. Ownership belongs outside the capability; do not put owner/schedule/goals into the capability itself.`,
};

export const DEFAULT_SKILL_CREATE_AGENT: SkillEntry = {
  slug: "create-agent",
  title: "create-agent",
  body: `State-repo \`agents/<slug>.md\` — a pure reusable identity file (markdown body: intent, allowed commands, restrictions). Agents have no schedule, no state, no run/tick; they're agent identities referenced by other flows. Same gap loop and sufficiency bar as Create Kody capability. Show body, then call \`create_kody_agent\`.`,
};
