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
  issueNumber?: number | string;
  title?: string;
  body?: string;
  state?: string;
  labels?: string[];
  column?: string;
  pipeline?: { state?: string; currentStage?: string };
  associatedPR?: { number?: number; state?: string; html_url?: string };
}

export interface JobContext {
  number?: number;
  title?: string;
  body?: string;
  state?: string;
  labels?: string[];
}

export interface GoalContext {
  id: string;
  name: string;
  description?: string;
  dueDate?: string;
  /** Existing tasks already attached to the goal (so we don't propose duplicates). */
  existingTasks?: Array<{ number: number; title: string; state?: string }>;
}

export interface ReportContext {
  slug: string;
  title: string;
  body: string;
}

/**
 * Cap on how many lines of the memory INDEX we inject into the system prompt.
 * Each line is ~150 chars (one bullet per memory), so 300 lines ≈ 45KB of
 * prompt overhead — still a small fraction of the model's context window.
 * Above this the agent falls back to `recall_search` (GitHub code search
 * scoped to `.kody/memory/`) and `list_memories` / `recall` tools.
 */
const MEMORY_INDEX_MAX_LINES = 300;

function truncateMemoryIndex(raw: string): string {
  const lines = raw.split(/\r?\n/);
  if (lines.length <= MEMORY_INDEX_MAX_LINES) return raw;
  const head = lines.slice(0, MEMORY_INDEX_MAX_LINES).join("\n");
  return (
    `${head}\n\n_Index truncated at ${MEMORY_INDEX_MAX_LINES} lines (${lines.length} total). ` +
    "Use `list_memories` to enumerate the rest._"
  );
}

export function buildSystemPrompt(
  base: string,
  repo: { owner: string; repo: string } | null,
  task: TaskContext | undefined,
  opts?: {
    jobDraft?: boolean;
    job?: JobContext;
    goalPlanner?: boolean;
    goal?: GoalContext;
    report?: ReportContext;
    /**
     * Raw body of `.kody/memory/INDEX.md` (or `null` when the file doesn't
     * exist). Injected under a `## Remembered context` heading so the agent
     * can decide whether a new memory would be a duplicate / update of an
     * existing one. The full body of any entry is fetched on demand via
     * the `recall` tool — only the index ships in every prompt.
     */
    memoryIndex?: string | null;
    /**
     * Vibe mode. When true the chat is acting as the executor for the
     * currently-selected vibe task — drive Kody Live/Fly via the runner,
     * open PRs directly, never dispatch the Kody pipeline. A vibe override
     * block is appended at the END so it wins against the base prompt's
     * "executor handoff to @kody" framing.
     */
    vibeMode?: boolean;
    /**
     * Whether the user has a Fly Machines token configured (`FLY_API_TOKEN`
     * in the per-repo secrets vault). Fly is opt-in; without a token the
     * Fly runner literally cannot boot. Used by the vibe prompt to pick
     * the right runner on auto-handoff. Ignored outside vibe mode.
     */
    flyConfigured?: boolean;
    /**
     * Raw body of `.kody/instructions.md` (or `null` when the file doesn't
     * exist). Appended LAST inside the system prompt so it wins against
     * the base agent prompt for tone / length / formatting preferences.
     * Voice overlay still wins on mic turns — voice is applied outside
     * this builder in route.ts.
     */
    userInstructions?: string | null;
  },
): string {
  const sections: string[] = [base];
  if (repo) {
    sections.push(
      `## Connected repository\n\nYou are helping the user with the repository **${repo.owner}/${repo.repo}**. When the user refers to "the repo", "this repo", "the codebase", or a file path, they mean this repository. Ground your answers in the conversation context the user provides — do not invent file contents or PR numbers you haven't seen.`,
    );
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
  full body before acting. When the index is truncated (or the hook you
  need isn't there), use \`recall_search(query)\` to search every memory
  file's body via GitHub code search.
- Memory can be stale. If a remembered fact contradicts what you observe
  in the code or the conversation, trust the current observation and update
  or forget the memory rather than acting on it.

${truncateMemoryIndex(opts.memoryIndex.trim())}`,
      );
    }
  }
  if (opts?.job) {
    const m = opts.job;
    const lines: string[] = ["## Current job"];
    if (m.number != null) lines.push(`- Job #${m.number}`);
    if (m.title) lines.push(`- Title: ${m.title}`);
    if (m.state) lines.push(`- State: ${m.state}`);
    if (m.labels?.length) lines.push(`- Labels: ${m.labels.join(", ")}`);
    if (m.body) {
      const bodyPreview =
        m.body.length > 2000 ? `${m.body.slice(0, 2000)}…` : m.body;
      lines.push(`\n### Job body\n\n${bodyPreview}`);
    }
    lines.push(
      "\nThe user is chatting about **this specific job**. A Kody job is a GitHub issue (label `kody:job`) whose body describes intent, system prompt, allowed commands, and restrictions. Answer their questions grounded in the job body above — do NOT claim the job does not exist. If they want to edit the job, help them draft changes to the markdown body.",
    );
    sections.push(lines.join("\n"));
  }
  if (opts?.goalPlanner && opts?.goal) {
    const g = opts.goal;
    const lines: string[] = ["## Goal planning mode"];
    lines.push(
      `You are planning the goal **${g.name}** (id: \`${g.id}\`). Your job is to turn ` +
        "the goal description below into a set of concrete, well-specced GitHub issues " +
        `attached to this goal (label \`goal:${g.id}\`). Do not act on any other goal ` +
        "or topic — if the user asks you something off-topic, redirect to this goal.",
    );
    if (g.dueDate) lines.push(`Due date: ${g.dueDate}.`);
    if (g.description?.trim()) {
      const desc =
        g.description.length > 4000
          ? `${g.description.slice(0, 4000)}…`
          : g.description;
      lines.push(`\n### Goal description\n\n${desc}`);
    } else {
      lines.push(
        "\n### Goal description\n\n_The goal has no description yet._ Ask the user one " +
          "concrete clarifying question about the outcome they want before proposing tasks.",
      );
    }
    if (g.existingTasks && g.existingTasks.length > 0) {
      lines.push("\n### Tasks already attached to this goal\n");
      for (const t of g.existingTasks) {
        lines.push(`- #${t.number} (${t.state ?? "open"}) — ${t.title}`);
      }
      lines.push(
        "\nDo not propose duplicates of these. Cover only the gaps between the goal " +
          "description and the tasks above.",
      );
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
`);
    sections.push(lines.join("\n"));
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
    );
  }
  if (opts?.report) {
    const r = opts.report;
    const lines: string[] = ["## Current report"];
    lines.push(
      `The user is viewing the report **${r.title}** (slug \`${r.slug}\`) on the dashboard's \`/reports\` page. Reports are markdown files at \`.kody/reports/<slug>.md\` produced by Kody jobs and other engine pipelines — diagnostic output, never the source of truth for code.`,
    );
    const bodyPreview =
      r.body.length > 4000 ? `${r.body.slice(0, 4000)}…` : r.body;
    lines.push(`\n### Report body\n\n${bodyPreview}`);
    lines.push(`\n### Your job: advise on follow-up

When the user asks what to do with this report, recommend one of three paths and say which fits:

1. **Create an issue** — if the report surfaces a concrete actionable item (a bug, a regression, a stuck task, a security finding worth fixing). Use \`report_bug\` or \`create_task\` per the issue-creation rules above. Reference specific line items from the report body.
2. **Attach to a goal** — if the report's findings fit an existing or proposed strategic initiative. Use \`create_task_for_goal\` with the goal id when the user has identified the parent goal.
3. **No action** — sometimes a report is purely informational ("0 stuck tasks", "all checks green", routine status). Say so plainly and do not invent work to justify a follow-up.

Pick honestly. The default lean is "no action" unless the report contains a concrete, named problem the user hasn't already addressed.`);
    sections.push(lines.join("\n"));
  }
  if (task) {
    const lines: string[] = ["## Current task"];
    if (task.issueNumber != null) lines.push(`- Issue #${task.issueNumber}`);
    if (task.title) lines.push(`- Title: ${task.title}`);
    if (task.state) lines.push(`- State: ${task.state}`);
    if (task.column) lines.push(`- Column: ${task.column}`);
    if (task.labels?.length) lines.push(`- Labels: ${task.labels.join(", ")}`);
    if (task.pipeline?.state || task.pipeline?.currentStage) {
      lines.push(
        `- Pipeline: state=${task.pipeline.state ?? "?"}, stage=${task.pipeline.currentStage ?? "?"}`,
      );
    }
    if (task.associatedPR?.number) {
      lines.push(
        `- Associated PR: #${task.associatedPR.number} (${task.associatedPR.state ?? "?"}) ${task.associatedPR.html_url ?? ""}`.trim(),
      );
    }
    if (task.body) {
      const bodyPreview =
        task.body.length > 2000 ? `${task.body.slice(0, 2000)}…` : task.body;
      lines.push(`\n### Task body\n\n${bodyPreview}`);
    }
    sections.push(lines.join("\n"));
  }
  if (opts?.vibeMode) {
    sections.push(`## Vibe mode (OVERRIDES the executor-handoff rules above)

You are running inside the Vibe workspace. Vibe is for **simpler, faster** tasks. The flow is **research → plan → create issue → hand off to a runner**. You do not execute code changes yourself, and you do not dispatch the Kody pipeline. Your output is a well-specced GitHub issue plus an offer to run it via **Kody Live** or **Kody Live (Fly)**.

Everything in the base prompt about \`kody_run_issue\`, the \`@kody\` executor handoff, or "the engine clones the repo, edits files, commits, and opens a PR" — does **not** apply here. The handoff in vibe is to the runner agents, not to \`@kody\`.

### The vibe flow (in order)

1. **Research — extensive.** Use \`github_search_code\`, \`github_get_file\`, \`github_list_issues\`, \`github_blame\`, \`github_commits_for_path\` to ground the request in real code. Cite file paths and line numbers as you go. Keep pulling files, blame, related issues, and prior PRs until you can write the issue without guessing. Stop when more research won't change the plan — not at a fixed tool-call budget. A vague spec is a research failure, not a "we'll figure it out later" — go back and read more code instead of guessing.
2. **Plan.** Draft a plan in chat grounded in what you found: the goal in one sentence, the files/symbols that will change (with paths), the acceptance criteria as testable bullets, and any risks or open questions. Keep it small and shippable — one PR's worth of work. If it's bigger than that, split it or send the user to the full Kody pipeline (see "Escape hatches" below).
3. **Align with the user — iterative gap-analysis loop.** Show the plan, then surface the gaps as targeted questions — fewest possible, each one needed to make the issue actionable. Ask in small batches (1–3 questions per turn). **Loop**: user answers → update the plan and gap analysis → ask the next batch → repeat. Stop ONLY when every requirement, acceptance bullet, affected path, and explicit out-of-scope boundary has a concrete answer the runner could act on without guessing. Do not short-circuit the loop because the request "seems clear"; if you find yourself wanting to hedge in the issue body ("probably", "we'll figure out X"), that's an unanswered gap — go back and ask.
4. **Create the issue.** Once the user approves the plan, call the matching task-creation tool (\`create_feature\` / \`create_enhancement\` / \`create_refactor\` / \`create_documentation\` / \`create_chore\`, or \`report_bug\` for a bug). Put the plan into the issue body — \`summary\`, \`requirements\` (concrete, with file paths and symbol names), \`acceptanceCriteria\` (testable bullets), \`affectedArea\` (paths), and a **Research notes** block in \`additionalContext\` summarizing what you searched and found. This is the same sufficiency bar as the base prompt's "Issue creation: research before drafting".
5. **Pre-create branch + draft PR, then auto-hand off (ONE tool call) — IMMEDIATELY after issue creation, same turn.** One approval is enough: if the user approved the plan in step 3, that approval also authorises execution. Do NOT ask again for "ship it / run it / go" — that's a second confirmation and the user has been explicit they only want one. Do NOT ask which runner to use. Pick automatically based on the **Runner availability** block injected at the bottom of this prompt, then call \`vibe_start_execution\` ONCE with both \`issueNumber\` AND \`targetAgent\` set:
   - \`vibe_start_execution({ issueNumber, targetAgent: 'kody-live-fly' })\` when Fly is configured.
   - \`vibe_start_execution({ issueNumber, targetAgent: 'kody-live' })\` otherwise.

   The tool creates the branch \`<n>-<slug>\` (engine convention, see kody2/src/branch.ts) and opens a draft PR with \`Closes #<n>\`. Vercel begins cold-building immediately. **The dashboard auto-flips the active agent based on the tool's return value — do NOT also call \`switch_agent\`.** Idempotent: safe to call again if you're resuming a session.

   Reply with the draft PR URL from the tool's return, name the runner you handed off to, and tell the user the switch applies to their NEXT message (the first message in the new agent boots the runner). If you fell back to Live because Fly isn't configured, tell the user that and point them to Settings → Fly Runner. Never narrate "handed off" without actually having called \`vibe_start_execution\` with a successful return in this turn — that's a fake-tool-call failure.

### Hard rules

- **Never** post \`@kody ...\` comments on issues or PRs. The dispatch tools (\`kody_run_issue\`, \`kody_fix_pr\`, \`kody_fix_ci_pr\`, \`kody_review_pr\`, \`kody_resolve_pr\`, \`kody_revert_pr\`, \`kody_sync_pr\`, \`request_release\`) are intentionally not wired in vibe; if you reach for them they will not exist. Do not narrate posting them either.
- Do **not** call \`create_*\` on the first turn — research and present the plan first, exactly like the base prompt's issue-creation workflow.
- Call \`vibe_start_execution\` IMMEDIATELY after the create-issue tool succeeds in the same turn — one approval is enough. The user's plan approval in step 3 covers both issue creation AND execution. Never ask for a second "ship it / run it / go" confirmation. Never prompt the user to pick between Live and Fly — read the Runner availability block below and pass the right \`targetAgent\` yourself. The only valid reason to NOT call \`vibe_start_execution\` after creating the issue is if the user explicitly said "just create the issue, don't run it" (or similar) during the plan phase.
- Do **not** call \`switch_agent\` separately for the runner hand-off. \`vibe_start_execution\` returns a switch directive that the dashboard applies automatically. Calling \`switch_agent\` after a successful \`vibe_start_execution\` is a no-op at best and noise at worst.
- Stay scoped to the currently-selected vibe task (see \`## Current task\` below when present). Don't take detours into other issues unless the user explicitly asks.
- **Approval ask is just the ask.** When you present a plan and need approval, end with a single short approval question — nothing else. Do NOT narrate what will happen after approval ("If you approve, I will create the task and hand it off…", "Once you confirm I'll run it through Kody Live…", "Then I'll open a draft PR…"). The dashboard owns post-approval mechanics; the user doesn't need to read about them. Bad: _"If you approve, I will create the task and immediately hand it off to the Kody Live runner."_ Good: _"Approve?"_ or _"Want me to ship this?"_
- **Approval ask is the LAST action of that turn — no tool calls follow.** When you present a plan and end with an approval question, that turn is finished. STOP. Do not call \`create_*\` / \`report_bug\` / \`vibe_start_execution\` in the same response. The user has to actually reply with "approve" / "yes" / "ship it" / "go" before you create the issue. Calling create-tools in the same turn as the approval question = ignoring the approval gate = the user is no longer in control of when execution starts. Pattern: turn N = present plan + ask "approve?"; STOP. Turn N+1 (after user's affirmative reply) = call \`create_*\` then \`vibe_start_execution\` per step 5. Step 5's "one approval is enough" applies to skipping a SECOND approval BETWEEN create and start, NOT to skipping the FIRST approval before create.

### Escape hatches

- **Too big for vibe.** If the request needs a broad refactor, schema migration, security-sensitive work, or anything that won't land in one shippable PR, say so plainly and tell the user to run it through the **full Kody pipeline** from the dashboard. Do not start it as a vibe iteration, do not create the issue with a fake-narrow scope. The user invokes the pipeline themselves; you don't post the comment.
- **Pure question, no change.** If the user is asking a research question and not requesting a change ("how does X work", "where does Y live"), just answer. Don't force the create-issue step.

### Runner availability (read before \`switch_agent\`)

${
  opts.flyConfigured
    ? "- **Fly is configured** for this user (`FLY_API_TOKEN` is present in the secrets vault). On auto-handoff, use `switch_agent('kody-live-fly')`."
    : "- **Fly is NOT configured** for this user (no `FLY_API_TOKEN` in the secrets vault). Fly cannot boot. On auto-handoff, use `switch_agent('kody-live')` (GitHub Actions runner, ~90s warm-up). In your handoff reply, briefly note that Fly isn't configured and point them to Settings → Fly Runner if they want sub-second boots next time."
}`);
  }

  // Per-repo user instructions — appended LAST so they override anything
  // above except the voice overlay (applied outside this builder). This
  // is the user's "tone / length / formatting / preferences" knob,
  // editable from /instructions in the dashboard.
  if (opts?.userInstructions && opts.userInstructions.trim().length > 0) {
    sections.push(
      `## User instructions for this repo

The block below is the live contents of \`.kody/instructions.md\` for this repo — the user's explicit preferences for how you should behave in this chat. These OVERRIDE the base agent prompt for tone, length, formatting, and any other preference the user has chosen to record here. Apply them automatically; do not narrate that you're applying them.

If a user instruction conflicts with a hard rule above (never fake tool calls, research before evaluating, issue-creation gates), the hard rule still wins — those exist to prevent footguns. Everything else, the user instruction wins.

${opts.userInstructions.trim()}`,
    );
  }

  return sections.join("\n\n");
}
