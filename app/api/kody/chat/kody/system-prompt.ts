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

export function buildSystemPrompt(
  base: string,
  repo: { owner: string; repo: string } | null,
  task: TaskContext | undefined,
): string {
  const sections: string[] = [base]
  if (repo) {
    sections.push(
      `## Connected repository\n\nYou are helping the user with the repository **${repo.owner}/${repo.repo}**. When the user refers to "the repo", "this repo", "the codebase", or a file path, they mean this repository. Ground your answers in the conversation context the user provides — do not invent file contents or PR numbers you haven't seen.`,
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
