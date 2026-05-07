/**
 * @fileType utility
 * @domain kody
 * @pattern system-prompt-builder
 *
 * Builds the Kody chat system prompt by stacking the base agent prompt, the
 * connected repository block, and the optional current-task block. Extracted
 * from route.ts so tests can import it without exporting non-HTTP handlers
 * from a Next.js route file.
 */

export interface TaskContext {
  issueNumber?: number | string
  title?: string
  body?: string
  state?: string
  labels?: string[]
  column?: string
  pipeline?: { state?: string; currentStage?: string }
  associatedPR?: { number?: number; state?: string; html_url?: string }
}

export interface MissionContext {
  number?: number
  title?: string
  body?: string
  state?: string
  labels?: string[]
}

export function buildSystemPrompt(
  base: string,
  repo: { owner: string; repo: string } | null,
  task: TaskContext | undefined,
  opts?: { missionDraft?: boolean; mission?: MissionContext },
): string {
  const sections: string[] = [base]
  if (repo) {
    sections.push(
      `## Connected repository\n\nYou are helping the user with the repository **${repo.owner}/${repo.repo}**. When the user refers to "the repo", "this repo", "the codebase", or a file path, they mean this repository. Ground your answers in the conversation context the user provides — do not invent file contents or PR numbers you haven't seen.`,
    )
    sections.push(
      `## Research first, ask second (HARD RULE)

When the user asks you to **analyze**, **audit**, **review**, **investigate**, **find bugs in**, **look for issues in**, **scan**, **explain how X works**, **find where Y is used**, **why something was written**, or **what changed** — start working immediately. Do NOT ask the user to narrow it down. Do NOT list your capabilities. Do NOT hedge about "running" or "executing" things.

"Analyze the admin dashboard" means **analyze the code of the admin dashboard** — read it, identify concrete issues, report findings. The same applies to any feature/page/module name. The user is asking you to do code analysis, not to run a server.

Required first move on any of those triggers, before responding:

1. \`github_search_code\` for the relevant symbols, file names, or feature keywords. The "admin dashboard" lives somewhere in the repo — find it.
2. \`github_get_file\` on the most relevant matches to read actual code.
3. \`github_blame\` / \`github_commits_for_path\` for "why" / "when" / "who" questions.
4. \`github_list_issues\` with relevant labels (e.g. \`bug\`) when the task is about known issues.
5. Chain up to 10 rounds. Stop as soon as you can answer; don't keep searching past that.

Then report findings as a concrete list with file paths and line numbers. Examples of good findings: "missing null guard at \`src/foo.ts:42\`", "TODO suggesting unfinished work at \`src/bar.ts:88\`", "two callers pass mismatched arg shapes at \`src/baz.ts:120\` vs \`src/qux.ts:55\`".

Forbidden response patterns on a research/analysis trigger:
- "I can't directly analyze a running dashboard" — the user means the code.
- "If you have specific areas you'd like me to examine, please provide…" — you pick the areas. That's the job.
- "My capabilities are limited to…" / "I can search for code, read files…" — never list your own capabilities; just use them.
- Any response that ends with a question to the user before you've called at least one tool.

Only ask a clarifying question after you've attempted the work and hit a genuine ambiguity that no amount of searching could resolve. Cite file paths and line numbers when referencing code.

This rule does **not** override the issue-creation workflow in the base prompt: when the user wants to file a bug or task, you still do gap-analysis and ask targeted questions before calling \`report_bug\` / \`create_*\`. The only change is that gap-analysis must start with at least one tool call (search/read/list_issues), not with capability hedging or "what would you like me to look at?".`,
    )
  }
  if (opts?.mission) {
    const m = opts.mission
    const lines: string[] = ['## Current mission']
    if (m.number != null) lines.push(`- Mission #${m.number}`)
    if (m.title) lines.push(`- Title: ${m.title}`)
    if (m.state) lines.push(`- State: ${m.state}`)
    if (m.labels?.length) lines.push(`- Labels: ${m.labels.join(', ')}`)
    if (m.body) {
      const bodyPreview = m.body.length > 2000 ? `${m.body.slice(0, 2000)}…` : m.body
      lines.push(`\n### Mission body\n\n${bodyPreview}`)
    }
    lines.push(
      '\nThe user is chatting about **this specific mission**. A Kody mission is a GitHub issue (label `kody:mission`) whose body describes intent, system prompt, allowed commands, and restrictions. Answer their questions grounded in the mission body above — do NOT claim the mission does not exist. If they want to edit the mission, help them draft changes to the markdown body.',
    )
    sections.push(lines.join('\n'))
  }
  if (opts?.missionDraft) {
    sections.push(
      `## Mission drafting mode

The user is **drafting a new Kody mission** — they are not asking about an existing one. A Kody mission is a GitHub issue (labelled \`kody:mission\`) whose markdown body describes:

- **Intent** — what the mission should accomplish
- **System prompt** — how Kody should behave when the mission runs
- **Allowed commands / tools** — what Kody is permitted to do
- **Restrictions** — what Kody must not do

Your job: **interview the user about every aspect of this mission until you reach a shared understanding** — do not draft until they signal they're ready. Ask short, concrete questions one turn at a time, drilling into goal, inputs, outputs, constraints, edge cases, success criteria, allowed tools, and restrictions. Prefer one focused question per turn over multi-part checklists. When the user explicitly says they're ready (or asks you to draft), produce a clean, copy-ready markdown draft with the four sections — Intent, System prompt, Allowed commands / tools, Restrictions — so they can hit **Use as mission** on your reply to turn it into a real mission. Never claim a mission already exists; there is no current mission to look up.`,
    )
  }
  if (task) {
    const lines: string[] = ["## Current task"]
    if (task.issueNumber != null) lines.push(`- Issue #${task.issueNumber}`)
    if (task.title) lines.push(`- Title: ${task.title}`)
    if (task.state) lines.push(`- State: ${task.state}`)
    if (task.column) lines.push(`- Column: ${task.column}`)
    if (task.labels?.length) lines.push(`- Labels: ${task.labels.join(", ")}`)
    if (task.pipeline?.state || task.pipeline?.currentStage) {
      lines.push(
        `- Pipeline: state=${task.pipeline.state ?? "?"}, stage=${task.pipeline.currentStage ?? "?"}`,
      )
    }
    if (task.associatedPR?.number) {
      lines.push(
        `- Associated PR: #${task.associatedPR.number} (${task.associatedPR.state ?? "?"}) ${task.associatedPR.html_url ?? ""}`.trim(),
      )
    }
    if (task.body) {
      const bodyPreview = task.body.length > 2000 ? `${task.body.slice(0, 2000)}…` : task.body
      lines.push(`\n### Task body\n\n${bodyPreview}`)
    }
    sections.push(lines.join("\n"))
  }
  return sections.join("\n\n")
}
