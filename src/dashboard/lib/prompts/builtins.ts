/**
 * @fileType data
 * @domain kody
 * @pattern prompts-builtins
 * @ai-summary Default prompts shipped with the dashboard. Each entry
 *   becomes a slash command in the chat (`/<slug>`). Repo-defined files
 *   at `.kody/prompts/<slug>.md` override built-ins by slug. Drop a file
 *   `.kody/prompts/.disable-builtins` in the repo to hide every built-in
 *   without overriding individually.
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
    slug: "issue",
    description: "Draft a new GitHub issue",
    argumentHint: "<title or short description>",
    body:
      "Draft a GitHub issue for: $ARGUMENTS.\n\n" +
      'Include a clear title, a short context paragraph, and a "Definition of done" checklist. ' +
      "Suggest relevant labels at the end. Do not open the issue yet — show me the draft first.",
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
    slug: "job",
    description: "Draft a scheduled Kody job",
    argumentHint: "<what should it do>",
    body:
      "Draft a Kody job that does the following: $ARGUMENTS.\n\n" +
      "Output the markdown for `.kody/jobs/<slug>.md` with `every:` frontmatter (pick a reasonable cadence), " +
      "a clear H1 title, a short context section, and step-by-step instructions. " +
      "End the body with the `## State` block that emits `nextEligibleISO`.",
  },
] as const;
