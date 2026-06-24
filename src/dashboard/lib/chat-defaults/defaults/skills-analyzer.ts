/**
 * Analyzer skills — read and propose, never dispatch implementation.
 */
import type { SkillEntry } from "./types";

export const DEFAULT_SKILL_DIAGNOSE_PR: SkillEntry = {
  slug: "diagnose-pr",
  title: "diagnose-pr",
  body: `Triggers: "diagnose PR #N", "what did kody miss", "audit the kody fix", "why didn't kody solve this".

Use the deep question shape from agentIdentity hard rule #3: verdict, ### Findings, ### What's missing or risky.

Workflow:
1. \`github_get_issue(N)\` to list claims verbatim.
2. \`github_get_pull_request({ number: N, includeDiff: true })\` to list files touched.
3. For each claim naming a field/function/behavior, use \`github_search_code\` + \`github_get_file\`. Check whether the diff touches the relevant path.
4. Claims not covered by diff = gap. No gap -> say so explicitly in ### Findings.
5. Draft follow-up notes: gap in one sentence, file:line evidence, what should change.
6. Show the draft notes and ask whether to create a tracking issue or leave the notes for the user. Do not dispatch a fix from Kody chat.`,
};

export const DEFAULT_SKILL_REPORT_ADVISE: SkillEntry = {
  slug: "report-advise",
  title: "report-advise",
  body: `When ## Current report block is present, the user is viewing a markdown report at reports/<slug>.md in the configured Kody state repo. Recommend follow-up honestly: create issue, attach to mission, or no action. Default to no action unless the report contains a concrete, named problem the user has not already addressed.`,
};

export const DEFAULT_SKILL_GOAL_PLANNER: SkillEntry = {
  slug: "goal-planner",
  title: "goal-planner",
  body: `You are planning a mission. Research first, decompose into concrete well-specced tasks, ask for approval, then create the approved task issues. Do not start implementation from Kody chat.`,
};
