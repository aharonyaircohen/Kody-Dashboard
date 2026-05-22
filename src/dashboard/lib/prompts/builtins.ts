/**
 * @fileType data
 * @domain kody
 * @pattern prompts-builtins
 * @ai-summary Default prompts shipped with the dashboard. Each entry
 *   becomes a slash command in the chat (`/<slug>`). Repo-defined files
 *   at `.kody/prompts/<slug>.md` override built-ins by slug. Drop a file
 *   `.kody/prompts/.disable-builtins` in the repo to hide every built-in
 *   without overriding individually.
 *
 *   `/research`, `/plan`, and `/issue` enforce the research-first flow
 *   the kody-live system prompt expects (see
 *   app/api/kody/chat/kody/system-prompt.ts "Issue creation: research
 *   before drafting"). `/issue` extends that with the executor handoff —
 *   after the issue is created the model offers to run it with Kody,
 *   gated on explicit user confirmation.
 */

export interface BuiltinPrompt {
  slug: string;
  description: string;
  argumentHint?: string;
  body: string;
}

export const BUILTIN_PROMPTS: readonly BuiltinPrompt[] = [
  {
    slug: "init",
    description: "Install the Kody engine in this repo",
    argumentHint: "[--force]",
    // Body is unused — KodyChat.sendMessage intercepts `/init` before
    // the slash-prompt expansion and runs the install action directly.
    // Kept here so the slash menu lists it as a first-class command.
    body: "",
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
    description: "Create a new goal",
    argumentHint: "<title>",
    body:
      'Create a new goal titled "$ARGUMENTS".\n\n' +
      "Capture the motivation, the success metric, and a rough first milestone. " +
      "Keep it tight — one paragraph each, no fluff.",
  },
  {
    slug: "analyze",
    description: "Analyze the current issue/PR/run on this page",
    body:
      "Analyze whatever I am currently viewing in the dashboard (issue, PR, run, or check). " +
      "Summarize the state, flag anything that looks wrong or stuck, and suggest the next concrete action.",
  },
  {
    slug: "duty",
    description: "Draft a scheduled Kody duty",
    argumentHint: "<what should it do>",
    body:
      "Draft a Kody duty that does the following: $ARGUMENTS.\n\n" +
      "Output the markdown for `.kody/duties/<slug>.md` with `every:` frontmatter (pick a reasonable cadence), " +
      "a clear H1 title, a short context section, and step-by-step instructions. " +
      "End the body with the `## State` block that emits `nextEligibleISO`.",
  },
] as const;
