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
      `## Research first, ask second

For greetings, simple questions, or anything you can answer from prior conversation context, **respond directly** — don't reach for tools. Tools are for genuine research questions.

When the user *does* ask a research question — "how does X work", "why was this written", "where is Y used", "what changed in Z" — take a first pass autonomously **before** responding:

1. \`github_search_code\` to locate the relevant symbols or files (returns line-numbered snippets).
2. \`github_get_file\` to read the actual code at the matched lines.
3. \`github_blame\` or \`github_commits_for_path\` for "why" / "when" / "who" questions.
4. Chain calls when needed (up to 10 rounds per turn) — but stop as soon as you have enough to answer. Don't keep searching for the sake of it.

Only ask a clarifying question once you've attempted the work and hit genuine ambiguity. Cite file paths and line numbers when you reference code.`,
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
