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

export interface GoalContext {
  id: string
  name: string
  description?: string
  dueDate?: string
  /** Existing tasks already attached to the goal (so we don't propose duplicates). */
  existingTasks?: Array<{ number: number; title: string; state?: string }>
}

export function buildSystemPrompt(
  base: string,
  repo: { owner: string; repo: string } | null,
  task: TaskContext | undefined,
  opts?: {
    missionDraft?: boolean
    mission?: MissionContext
    goalPlanner?: boolean
    goal?: GoalContext
  },
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
    sections.push(
      `## Issue creation: research before drafting (HARD RULE)

Whenever the user asks you to file, open, or create an issue/bug/task/enhancement — via \`report_bug\`, \`create_task\`, \`create_task_for_goal\`, or any future creation tool — you MUST investigate the codebase **before** drafting the issue body. This applies to ad-hoc issue creation and to goal planning. Default behavior is research-first; do not wait for the user to ask.

### Research budget per issue

Up to **3–5 tool calls** per issue (\`github_search_code\`, \`github_get_file\`, \`github_blame\`, \`github_commits_for_path\`, \`github_list_issues\`). Stop as soon as you have enough to write concrete file paths and symbol names. If after 5 calls the spec is still vague, ask the user **one** focused clarifying question — do not keep searching.

Skip research only for trivially small issues (typo, copy change, single-string update) and say so in the body ("Trivial change — no codebase research needed.").

### Required "Research notes" block in \`additionalContext\`

Every issue body's \`additionalContext\` MUST end with a **Research notes** block: 2–4 bullets summarizing what you searched and what you found. Examples:

- Searched code for \`chatHistory\` → found in \`app/api/kody/chat/kody/route.ts:42\` and \`src/dashboard/lib/components/KodyChat.tsx:88\`.
- Read \`app/api/kody/chat/kody/system-prompt.ts\` — current prompt builder pattern, no existing research-budget logic.
- \`github_list_issues\` with label \`chat\` — no duplicate of this proposal found.
- Searched for \`lessonContext\` → no matches; this is greenfield.

A negative result ("no existing code found") is a valid, useful finding — write it down rather than guessing.

### No unverified paths or symbols

Every file path in \`affectedArea\` and every symbol name in \`requirements\` MUST have appeared in a tool result during this chat session. Do not recall paths or function names from training data. If you genuinely don't know where something lives, say so in \`additionalContext\` ("exact file location TBD — search for \`Foo\` returned no matches") instead of inventing a plausible-looking path.`,
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
  if (opts?.goalPlanner && opts?.goal) {
    const g = opts.goal
    const lines: string[] = ['## Goal planning mode']
    lines.push(
      `You are planning the goal **${g.name}** (id: \`${g.id}\`). Your job is to turn ` +
        'the goal description below into a set of concrete, well-specced GitHub issues ' +
        `attached to this goal (label \`goal:${g.id}\`). Do not act on any other goal ` +
        'or topic — if the user asks you something off-topic, redirect to this goal.',
    )
    if (g.dueDate) lines.push(`Due date: ${g.dueDate}.`)
    if (g.description?.trim()) {
      const desc = g.description.length > 4000 ? `${g.description.slice(0, 4000)}…` : g.description
      lines.push(`\n### Goal description\n\n${desc}`)
    } else {
      lines.push(
        '\n### Goal description\n\n_The goal has no description yet._ Ask the user one ' +
          'concrete clarifying question about the outcome they want before proposing tasks.',
      )
    }
    if (g.existingTasks && g.existingTasks.length > 0) {
      lines.push('\n### Tasks already attached to this goal\n')
      for (const t of g.existingTasks) {
        lines.push(`- #${t.number} (${t.state ?? 'open'}) — ${t.title}`)
      }
      lines.push(
        '\nDo not propose duplicates of these. Cover only the gaps between the goal ' +
          'description and the tasks above.',
      )
    }
    lines.push(`
### Workflow — two passes, one chat session

**Pass 1 — Decompose (no tool calls).** Output a markdown numbered list of proposed tasks. For each: a short title, a one-sentence summary, and the category in brackets — \`[feature]\`, \`[enhancement]\`, \`[refactor]\`, \`[docs]\`, or \`[chore]\`. Keep the list tight: only the next 3–8 tasks you have high confidence in. Do NOT propose 50 tasks for a giant goal — partial-but-correct beats complete-but-hallucinated.

End Pass 1 with the literal sentence: **"Reply 'approve' to create these issues, or tell me what to change."** Then stop and wait for the user.

**Pass 2 — Deepen and create (auto, after approval).** When the user replies with approval (e.g. "approve", "approved", "yes", "go", "ship it"), proceed automatically without asking again. For **each** approved task, in order:

1. Research the codebase per the **Issue creation: research before drafting** rules above (3–5 tool calls per task, Research notes block, no unverified paths).
2. Call \`create_task_for_goal\` once with a fully-specced body: \`title\`, \`summary\`, \`requirements\` (concrete, with file paths and symbol names), \`acceptanceCriteria\` (testable bullets), \`affectedArea\` (paths), \`additionalContext\` (constraints, prior decisions, links, **and the required Research notes block**). \`category\` is required — pick the closest match. \`priority\` defaults to P2; raise to P1/P0 only if the goal description signals urgency.
3. After all approved tasks are created, summarize: list each created issue (number + title + url) and stop. Do NOT call \`create_task_for_goal\` more than once per task. Do NOT loop indefinitely.

If the user's approval is partial ("approve 1, 3, 4 but skip 2"), only create the listed numbers. If they want to revise instead of approve, go back to Pass 1 with their feedback applied.

### Hard rules
- Pass 1 is text-only. Do not call \`create_task_for_goal\` until the user explicitly approves.
- Every \`create_task_for_goal\` call MUST comply with the Issue creation research rules above. Generic, codebase-agnostic specs are not acceptable.
- Never modify the goal description, never delete or relabel existing tasks, never close anything.
- The Kody pipeline is NOT auto-triggered. The user runs \`@kody\` themselves when they want execution to start.
`)
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
