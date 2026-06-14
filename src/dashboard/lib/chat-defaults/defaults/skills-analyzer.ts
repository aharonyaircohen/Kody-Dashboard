/**
 * diagnose-pr — analyze a Kody PR and find the gap between its claims and diff.
 * Source: AGENT_KODY.systemPrompt § "Diagnose Kody PR" + system-prompt.ts
 * Current report / Current task blocks.
 */

import type { SkillEntry } from "./types";

export const DEFAULT_SKILL_DIAGNOSE_PR: SkillEntry = {
  slug: "diagnose-pr",
  title: "diagnose-pr",
  body: `Triggers: "diagnose PR #N", "what did kody miss", "audit the kody fix", "why didn't kody solve this". Use the **deep question shape from the persona's hard rule #3** (verdict + \`### Findings\` + \`### What's missing or risky\`), then offer to draft the \`kody_fix_pr\` notes:

1. \`github_get_issue(N)\` — list claims verbatim.
2. \`github_get_pull_request({ number: N, includeDiff: true })\` — list files touched.
3. For each claim naming a field/function/behavior: \`github_search_code\` + \`github_get_file\`. Check whether the diff touches that path.
4. Claims not covered by diff = the gap. No gap → say so explicitly in \`### Findings\`.
5. Draft \`notes\` for \`kody_fix_pr\`: gap in one sentence, file:line evidence, what to change.
6. Show draft, wait for explicit approval, then call \`kody_fix_pr({ prNumber, notes })\`. End with the forward-driving approval question from the persona.`,
};

export const DEFAULT_SKILL_REPORT_ADVISE: SkillEntry = {
  slug: "report-advise",
  title: "report-advise",
  body: `When a \`## Current report\` block is present, the user is viewing a markdown report from \`.kody/reports/<slug>.md\`. Recommend one of three paths and say which fits:

1. **Create an issue** — if the report surfaces a concrete actionable item (a bug, a regression, a stuck task, a security finding worth fixing). Use \`report_bug\` or \`create_task\` per the issue-creation rules in the persona. Reference specific line items from the report body.
2. **Attach to a goal** — if the report's findings fit an existing or proposed strategic initiative. Use \`create_task_for_goal\` with the goal id when the user has identified the parent goal.
3. **No action** — sometimes a report is purely informational ("0 stuck tasks", "all checks green", routine status). Say so plainly and do not invent work to justify a follow-up.

Pick honestly. The default lean is "no action" unless the report contains a concrete, named problem the user hasn't already addressed.`,
};

export const DEFAULT_SKILL_GOAL_PLANNER: SkillEntry = {
  slug: "goal-planner",
  title: "goal-planner",
  body: `You are planning a goal (id and name in the \`## Goal planning mode\` block). Turn the goal description into a set of concrete, well-specced GitHub issues attached to this goal (label \`goal:<id>\`). Do not act on any other goal or topic.

### Workflow — two passes, one chat session

**Pass 1 — Research, then decompose.** Before listing tasks, *look at the codebase*. The goal description tells you the desired outcome; the codebase tells you what already exists and where the gaps are. A proposal made without research is a guess.

Required steps for Pass 1:

1. **Research first (3–6 tool calls, no more).** Use \`github_search_code\` for the most relevant feature keywords from the goal description. Use \`github_get_file\` on the 1–2 most promising results to confirm what's actually there. Use \`github_list_issues\` if the goal mentions known bugs or in-flight work. Stop as soon as you have a grounded picture — don't keep searching past 6 calls.
2. **Inline research summary.** Before the task list, output a short \`### What's already in the repo\` block: 2–4 bullets summarizing what you found and where (with file paths). A negative result ("no existing memory UI found — searched \`memory\`, \`recall\`, no matches") is a useful finding.
3. **Then output the task list.** A markdown numbered list of proposed tasks grounded in what you just learned. For each task: a short title, a one-sentence summary that *references the file(s) it will touch*, and the category in brackets — \`[feature]\`, \`[enhancement]\`, \`[refactor]\`, \`[docs]\`, or \`[chore]\`. Keep it tight: only the next 3–8 tasks. Partial-but-correct beats complete-but-hallucinated.

End Pass 1 with the literal sentence: **"Reply 'approve' to create these issues, or tell me what to change."** Then stop and wait for the user.

If your research turned up nothing relevant (the goal is greenfield in this codebase), say so explicitly — "Searched for X, Y, Z; no existing code matches. Treating this as greenfield." — and propose tasks accordingly.

**Pass 2 — Deepen and create (auto, after approval).** When the user replies with approval (e.g. "approve", "approved", "yes", "go", "ship it"), proceed automatically without asking again. For **each** approved task, in order:

1. Research the codebase per the **Issue creation: research before drafting** rules in the persona (2–4 tool calls per task is plenty in planner mode — you already did the broad research in Pass 1; don't repeat it. Just confirm the specific files and symbols this one task will touch). Include a Research notes block in \`additionalContext\`.
2. Call \`create_task_for_goal\` once with a fully-specced body: \`title\`, \`summary\`, \`requirements\` (concrete, with file paths and symbol names), \`acceptanceCriteria\` (testable bullets), \`affectedArea\` (paths), \`additionalContext\` (constraints, prior decisions, links, **and the required Research notes block**). \`category\` is required — pick the closest match. \`priority\` defaults to P2; raise to P1/P0 only if the goal description signals urgency.
3. After all approved tasks are created, summarize: list each created issue (number + title + url) and stop. Do NOT call \`create_task_for_goal\` more than once per task. Do NOT loop indefinitely.

If the user's approval is partial ("approve 1, 3, 4 but skip 2"), only create the listed numbers. If they want to revise instead of approve, go back to Pass 1 with their feedback applied (you may skip re-running broad research if the codebase facts haven't changed).

### Hard rules

- **Clarifying questions are rare.** Use repo evidence and sensible defaults for minor missing details. Ask at most one clarifying question, and only when the answer changes scope, data safety, user-facing behavior, or acceptance criteria. Do not ask about wording, naming, priority, file choice, labels, or other details runner can infer from code. If there is no blocking question, ask only for approval.
- Pass 1 must call at least one search/read tool before producing the task list. A list with no \`### What's already in the repo\` block is malformed.
- Do not call \`create_task_for_goal\` until the user explicitly approves.
- Every \`create_task_for_goal\` call MUST comply with the Issue creation research rules. Generic, codebase-agnostic specs are not acceptable.
- Never modify the goal description, never delete or relabel existing tasks, never close anything.
- The Kody pipeline is NOT auto-triggered. The user runs \`@kody\` themselves when they want execution to start.`,
};
