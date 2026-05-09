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

export interface JobContext {
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

export interface ReportContext {
  slug: string
  title: string
  body: string
}

/**
 * Cap on how many lines of the memory INDEX we inject into the system prompt.
 * Each line is ~150 chars (one bullet per memory), so 80 lines ≈ 12KB of
 * prompt overhead. Above this the agent should rely on `list_memories` /
 * `recall` tools instead of having every entry in the prompt.
 */
const MEMORY_INDEX_MAX_LINES = 80

function truncateMemoryIndex(raw: string): string {
  const lines = raw.split(/\r?\n/)
  if (lines.length <= MEMORY_INDEX_MAX_LINES) return raw
  const head = lines.slice(0, MEMORY_INDEX_MAX_LINES).join('\n')
  return (
    `${head}\n\n_Index truncated at ${MEMORY_INDEX_MAX_LINES} lines (${lines.length} total). ` +
    'Use `list_memories` to enumerate the rest._'
  )
}

export function buildSystemPrompt(
  base: string,
  repo: { owner: string; repo: string } | null,
  task: TaskContext | undefined,
  opts?: {
    jobDraft?: boolean
    job?: JobContext
    goalPlanner?: boolean
    goal?: GoalContext
    report?: ReportContext
    /**
     * Raw body of `.kody/memory/INDEX.md` (or `null` when the file doesn't
     * exist). Injected under a `## Remembered context` heading so the agent
     * can decide whether a new memory would be a duplicate / update of an
     * existing one. The full body of any entry is fetched on demand via
     * the `recall` tool — only the index ships in every prompt.
     */
    memoryIndex?: string | null
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
    if (opts?.memoryIndex && opts.memoryIndex.trim().length > 0) {
      sections.push(
        `## Remembered context

The block below is the live index of \`.kody/memory/*.md\` for this repo.
Each bullet is one stored memory: title, file id, one-line hook, and type.
Treat it as the agent's persistent notes — facts/feedback/project context the
user has chosen to keep across sessions.

Rules:
- Read this index before writing a new memory. If a similar entry already
  exists, call \`update_memory\` instead of \`remember\` — duplicates are
  noise.
- Apply remembered \`feedback\` and \`user\` entries automatically (e.g. if a
  feedback memory says "no console.log in this repo," don't add console.log
  even if the current turn doesn't mention it).
- Use \`recall(id)\` when the one-line hook isn't enough and you need the
  full body before acting.
- Memory can be stale. If a remembered fact contradicts what you observe
  in the code or the conversation, trust the current observation and update
  or forget the memory rather than acting on it.

${truncateMemoryIndex(opts.memoryIndex.trim())}`,
      )
    }
  }
  if (opts?.job) {
    const m = opts.job
    const lines: string[] = ['## Current job']
    if (m.number != null) lines.push(`- Job #${m.number}`)
    if (m.title) lines.push(`- Title: ${m.title}`)
    if (m.state) lines.push(`- State: ${m.state}`)
    if (m.labels?.length) lines.push(`- Labels: ${m.labels.join(', ')}`)
    if (m.body) {
      const bodyPreview = m.body.length > 2000 ? `${m.body.slice(0, 2000)}…` : m.body
      lines.push(`\n### Job body\n\n${bodyPreview}`)
    }
    lines.push(
      '\nThe user is chatting about **this specific job**. A Kody job is a GitHub issue (label `kody:job`) whose body describes intent, system prompt, allowed commands, and restrictions. Answer their questions grounded in the job body above — do NOT claim the job does not exist. If they want to edit the job, help them draft changes to the markdown body.',
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

**Pass 1 — Research, then decompose.** Before listing tasks, *look at the codebase*. The goal description tells you the desired outcome; the codebase tells you what already exists and where the gaps are. A proposal made without research is a guess.

Required steps for Pass 1:

1. **Research first (3–6 tool calls, no more).** Use \`github_search_code\` for the most relevant feature keywords from the goal description. Use \`github_get_file\` on the 1–2 most promising results to confirm what's actually there. Use \`github_list_issues\` if the goal mentions known bugs or in-flight work. Stop as soon as you have a grounded picture — don't keep searching past 6 calls.
2. **Inline research summary.** Before the task list, output a short \`### What's already in the repo\` block: 2–4 bullets summarizing what you found and where (with file paths). A negative result ("no existing memory UI found — searched \`memory\`, \`recall\`, no matches") is a useful finding.
3. **Then output the task list.** A markdown numbered list of proposed tasks grounded in what you just learned. For each task: a short title, a one-sentence summary that *references the file(s) it will touch*, and the category in brackets — \`[feature]\`, \`[enhancement]\`, \`[refactor]\`, \`[docs]\`, or \`[chore]\`. Keep it tight: only the next 3–8 tasks. Partial-but-correct beats complete-but-hallucinated.

End Pass 1 with the literal sentence: **"Reply 'approve' to create these issues, or tell me what to change."** Then stop and wait for the user.

If your research turned up nothing relevant (the goal is greenfield in this codebase), say so explicitly — "Searched for X, Y, Z; no existing code matches. Treating this as greenfield." — and propose tasks accordingly.

**Pass 2 — Deepen and create (auto, after approval).** When the user replies with approval (e.g. "approve", "approved", "yes", "go", "ship it"), proceed automatically without asking again. For **each** approved task, in order:

1. Research the codebase per the **Issue creation: research before drafting** rules above (2–4 tool calls per task is plenty in planner mode — you already did the broad research in Pass 1; don't repeat it. Just confirm the specific files and symbols this one task will touch). Include a Research notes block in \`additionalContext\`.
2. Call \`create_task_for_goal\` once with a fully-specced body: \`title\`, \`summary\`, \`requirements\` (concrete, with file paths and symbol names), \`acceptanceCriteria\` (testable bullets), \`affectedArea\` (paths), \`additionalContext\` (constraints, prior decisions, links, **and the required Research notes block**). \`category\` is required — pick the closest match. \`priority\` defaults to P2; raise to P1/P0 only if the goal description signals urgency.
3. After all approved tasks are created, summarize: list each created issue (number + title + url) and stop. Do NOT call \`create_task_for_goal\` more than once per task. Do NOT loop indefinitely.

If the user's approval is partial ("approve 1, 3, 4 but skip 2"), only create the listed numbers. If they want to revise instead of approve, go back to Pass 1 with their feedback applied (you may skip re-running broad research if the codebase facts haven't changed).

### Hard rules
- Pass 1 must call at least one search/read tool before producing the task list. A list with no \`### What's already in the repo\` block is malformed.
- Do not call \`create_task_for_goal\` until the user explicitly approves.
- Every \`create_task_for_goal\` call MUST comply with the Issue creation research rules above. Generic, codebase-agnostic specs are not acceptable.
- Never modify the goal description, never delete or relabel existing tasks, never close anything.
- The Kody pipeline is NOT auto-triggered. The user runs \`@kody\` themselves when they want execution to start.
`)
    sections.push(lines.join('\n'))
  }
  if (opts?.jobDraft) {
    sections.push(
      `## Job drafting mode

The user is **drafting a new Kody job** — they are not asking about an existing one. A Kody job is a GitHub issue (labelled \`kody:job\`) whose markdown body describes:

- **Intent** — what the job should accomplish
- **System prompt** — how Kody should behave when the job runs
- **Allowed commands / tools** — what Kody is permitted to do
- **Restrictions** — what Kody must not do

Your job: **interview the user about every aspect of this job until you reach a shared understanding** — do not draft until they signal they're ready. Ask short, concrete questions one turn at a time, drilling into goal, inputs, outputs, constraints, edge cases, success criteria, allowed tools, and restrictions. Prefer one focused question per turn over multi-part checklists. When the user explicitly says they're ready (or asks you to draft), produce a clean, copy-ready markdown draft with the four sections — Intent, System prompt, Allowed commands / tools, Restrictions — so they can hit **Use as job** on your reply to turn it into a real job. Never claim a job already exists; there is no current job to look up.`,
    )
  }
  if (opts?.report) {
    const r = opts.report
    const lines: string[] = ['## Current report']
    lines.push(`The user is viewing the report **${r.title}** (slug \`${r.slug}\`) on the dashboard's \`/reports\` page. Reports are markdown files at \`.kody/reports/<slug>.md\` produced by Kody jobs and other engine pipelines — diagnostic output, never the source of truth for code.`)
    const bodyPreview = r.body.length > 4000 ? `${r.body.slice(0, 4000)}…` : r.body
    lines.push(`\n### Report body\n\n${bodyPreview}`)
    lines.push(`\n### Your job: advise on follow-up

When the user asks what to do with this report, recommend one of three paths and say which fits:

1. **Create an issue** — if the report surfaces a concrete actionable item (a bug, a regression, a stuck task, a security finding worth fixing). Use \`report_bug\` or \`create_task\` per the issue-creation rules above. Reference specific line items from the report body.
2. **Attach to a goal** — if the report's findings fit an existing or proposed strategic initiative. Use \`create_task_for_goal\` with the goal id when the user has identified the parent goal.
3. **No action** — sometimes a report is purely informational ("0 stuck tasks", "all checks green", routine status). Say so plainly and do not invent work to justify a follow-up.

Pick honestly. The default lean is "no action" unless the report contains a concrete, named problem the user hasn't already addressed.`)
    sections.push(lines.join('\n'))
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
