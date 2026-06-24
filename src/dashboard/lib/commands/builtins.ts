/**
 * @fileType data
 * @domain kody
 * @pattern commands-builtins
 * @ai-summary Fallback commands bundled with the dashboard for cold-start
 *   and unavailable-Store cases. Shared command catalog lives in Store.
 *   Repo and Store `.kody/commands/<slug>.md` files shadow these by slug.
 *   Drop `.kody/commands/.disable-builtins` in the repo to hide every fallback
 *   built-in without overriding individually.
 *
 *   Matching Store files for `/research`, `/plan`, and `/issue` enforce
 *   the research-first flow the kody-live system prompt expects (see
 *   app/api/kody/chat/kody/system-prompt.ts "Issue creation: research
 *   before drafting"). `/issue` extends that with the executor handoff —
 *   after the issue is created the model offers to run it with Kody,
 *   gated on explicit user confirmation.
 */

export interface BuiltinCommand {
  slug: string;
  description: string;
  argumentHint?: string;
  body: string;
}

export const BUILTIN_COMMANDS: readonly BuiltinCommand[] = [
  {
    slug: "init",
    description: "Install the Kody engine in this repo",
    argumentHint: "[--force]",
    // Body is unused — KodyChat.sendMessage intercepts `/init` before
    // the slash-command expansion and runs the install action directly.
    // Kept here so the slash menu lists it as a first-class command.
    body: "",
  },
  {
    slug: "briefing",
    description: "Summarize what needs attention",
    body:
      "Run the Work Briefing.\n\n" +
      "First call `read_agentAction` for slug `work-briefing` and follow its `work-briefing` skill. " +
      "If it is not available, use the method below directly.\n\n" +
      "Use available read-only tools to gather current state:\n\n" +
      "- `list_reports`, then `read_report` for action-needed or recent reports\n" +
      "- `github_list_issues` for open tasks and waiting items\n" +
      "- `kody_list_open_prs` for PRs in review\n" +
      "- `kody_list_workflow_runs` for recent failures or running CI\n" +
      "- `list_inbox` for waiting decisions\n" +
      "- `list_goals` for active missions (legacy task groups)\n\n" +
      "Return the briefing in chat. Do not create, assign, close, edit, or solve anything.",
  },
  {
    slug: "plan",
    description: "Plan a change before writing code",
    argumentHint: "<task>",
    body:
      "Plan how to do this without writing code yet: $ARGUMENTS.\n\n" +
      "List the files to touch, risks to watch for, and a 3–5 step order. " +
      "Stop before implementing.",
  },
  {
    slug: "review",
    description: "Review my uncommitted changes",
    body:
      "Review my uncommitted changes for bugs, missing error handling, and risky patterns. " +
      "Focus on the diff itself — skip style nits.",
  },
  {
    slug: "explain",
    description: "Explain a topic in this codebase",
    argumentHint: "<topic>",
    body:
      "Explain $ARGUMENTS in this codebase: where it lives, how it is wired, and what calls into it. " +
      "Cite concrete file paths.",
  },
  {
    slug: "research",
    description: "Investigate a topic without writing code",
    argumentHint: "<topic>",
    body:
      "Research $ARGUMENTS in this repo. Do NOT write code, open issues, or " +
      "dispatch any pipeline — research only.\n\n" +
      "1. Use search/read/blame tools (3–5 calls) to find where it lives.\n" +
      "2. Note related symbols, file paths, prior art, and any blockers.\n" +
      "3. Summarize findings in 4–6 bullets with concrete `path:line` citations.\n" +
      "4. End with a one-line suggestion for the next step (plan, issue, ignore).\n\n" +
      "Stop after the summary.",
  },
  {
    slug: "issue",
    description: "Research → draft → create a GitHub issue",
    argumentHint: "<title or short description>",
    body:
      "Open a GitHub issue for: $ARGUMENTS.\n\n" +
      "Follow the research-plan flow — do NOT skip steps:\n\n" +
      "1. **Research first.** 3–5 tool calls (`github_search_code`, " +
      "`github_get_file`, `github_blame`, `github_list_issues`) to find " +
      "affected files, symbols, and prior art. Negative results count.\n" +
      "2. **Draft the body** with concrete `path:line` references, " +
      "`requirements` (file paths + symbol names), `acceptanceCriteria` " +
      "(testable bullets), `affectedArea` (paths), and a mandatory " +
      "**Research notes** block in `additionalContext` (2–4 bullets " +
      "summarizing what you searched and what you found).\n" +
      "3. **Show me the draft.** Wait for explicit approval before " +
      "calling the matching `create_*` tool. No unverified paths or " +
      "symbols.\n" +
      "4. **After the issue is created**, ask whether to execute it " +
      "with Kody. Only call `kody_run_issue(issueNumber, notes=<the plan>)` " +
      "if I confirm — never dispatch automatically.",
  },
  {
    slug: "goal",
    description: "Create a company goal",
    argumentHint: "<outcome>",
    body:
      'Create a new company-level goal for "$ARGUMENTS".\n\n' +
      "Use the managed goal model: outcome, proof/evidence, route, facts, and blockers. " +
      "Prefer managed-goal tools when available. Keep the first route simple.",
  },
  {
    slug: "mission",
    description: "Create a mission task group",
    argumentHint: "<title>",
    body:
      'Create a new mission titled "$ARGUMENTS".\n\n' +
      "A mission is the old task grouping under the task page: it collects concrete tasks toward one focused effort. " +
      "Capture motivation, success metric, and rough first milestone. Keep it tight — one paragraph each, no fluff.",
  },
  {
    slug: "analyze",
    description: "Analyze the current issue/PR/run on this page",
    body:
      "Analyze whatever I am currently viewing in the dashboard (issue, PR, run, or check). " +
      "Summarize the state, flag anything that looks wrong or stuck, and suggest the next concrete action.",
  },
  {
    slug: "agentResponsibility",
    description: "Draft a scheduled Kody agentResponsibility",
    argumentHint: "<what should it do>",
    body:
      "Draft a Kody agentResponsibility that does the following: $ARGUMENTS.\n\n" +
      "Output a folder proposal for `.kody/agent-responsibilities/<slug>/` with `profile.json` metadata " +
      "(action, agentAction when needed, every, agent, readsFrom/writesTo) and a " +
      "`agent-responsibility.md` body with a clear H1, `## Job`, `## AgentAction` when relevant, " +
      "`## Output`, `## Allowed Commands`, and `## Restrictions`. Keep implementation " +
      "recipes in agentAction skills/scripts, not in the agentResponsibility body.",
  },
] as const;
