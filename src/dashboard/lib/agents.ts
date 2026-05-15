/**
 * @fileType config
 * @domain kody
 * @pattern agent-config
 * @ai-summary Single unified agent definition for Kody chat
 */

import { Brain, Zap, type LucideIcon } from 'lucide-react'

// ===========================================
// AGENT CONFIG
// ===========================================

/**
 * Which backend runs a given agent.
 * - 'kody-engine': async via GH Actions workflow (chat.yml) + Kody Engine.
 * - 'brain': sync SSE to the Brain chat server (Claude Agent SDK, session-resumed).
 * - 'kody-direct': in-process via Vercel AI SDK (default Kody agent).
 * - 'kody-live': long-lived interactive runner (GH Actions or Fly Machines).
 */
export type ChatBackend = 'kody-engine' | 'brain' | 'kody-direct' | 'kody-live'

export type AgentId =
  | 'brain'
  | 'brain-fly'
  | 'kody'
  | 'kody-live'
  | 'kody-live-fly'

/**
 * True for agents that use the long-lived "interactive runner" flow
 * (poll-based session JSONL, /interactive/start + /interactive/append).
 * Both `kody-live` (GH Actions) and `kody-live-fly` (Fly Machines) share
 * the engine code and event-stream model — only the runtime differs.
 */
export function isLiveAgent(id: AgentId | string): boolean {
  return id === 'kody-live' || id === 'kody-live-fly'
}

export interface AgentConfig {
  id: AgentId
  name: string
  description: string
  icon: LucideIcon
  capabilities: string[]
  systemPrompt: string
  backend: ChatBackend
  /**
   * Whether voice mode (mic icon → STT → backend → TTS) can run against
   * this agent. Voice requires (a) a route that knows how to apply the
   * voice overlay to that agent's system prompt, and (b) low-enough
   * end-to-end latency that the TTS playback doesn't drift.
   *
   * kody-direct + brain meet both bars. kody-live (GH Actions / Fly
   * Machines + JSONL polling fallback) is too async — the user would
   * hear the start of a reply minutes after speaking. The flag is the
   * single source of truth for the mic gate, both in the chat UI and
   * the `switch_agent` tool's voice-handling logic.
   */
  supportsVoice: boolean
}

// ===========================================
// REMOTE DEV EXTENSION
// ===========================================

/**
 * System prompt extension injected when a remote dev environment is configured
 * for the current user. Appended to the agent's base system prompt.
 */
export const REMOTE_SYSTEM_PROMPT_EXTENSION = `
## Remote Dev Environment

You have access to four additional tools for interacting with the user's remote Mac dev environment:

**Remote Tools** (only available when remote dev is configured):
- remoteExec: Execute shell commands on the remote Mac (30s timeout, 512KB output cap)
- remoteRead: Read file contents from the remote Mac (1MB limit)
- remoteWrite: Write files to the remote Mac
- remoteLs: List directory contents on the remote Mac

**Remote Tool Rules**:
- Use these tools when the user asks about their local dev environment, running processes, or local files
- Commands run with the user's local permissions — be careful with destructive operations
- Always confirm before running commands that modify files or state
- The remote environment is the user's own Mac development machine
`

// ===========================================
// BRAIN AGENT
// ===========================================

/**
 * Brain runs on a dedicated VPS with Claude Agent SDK, a live worktree of the
 * connected repo, and persistent session memory. Messages bypass the GH Actions
 * pipeline and stream directly over SSE.
 *
 * The system prompt is applied server-side by Brain's own profile; this one is
 * shown only for UI listing purposes.
 */
export const AGENT_BRAIN: AgentConfig = {
  id: 'brain',
  name: 'Kody Brain',
  description: 'Claude-powered code research with a live repo checkout and session memory',
  icon: Brain,
  backend: 'brain',
  supportsVoice: true,
  capabilities: [
    'Explore the repository with real Grep, Glob, and Read',
    'Follow code across files to answer architectural questions',
    'Remember context across turns within the same chat',
    'Run gh CLI for GitHub data (issues, PRs, workflows)',
    'Summarize and explain unfamiliar areas of the codebase',
  ],
  systemPrompt: 'Handled by the Brain server profile.',
}

// ===========================================
// KODY BRAIN ON FLY
// ===========================================

/**
 * Same Brain shape as AGENT_BRAIN (chat-with-tools, session memory, live
 * worktree), but the server runs on a per-user Fly Machine instead of the
 * external Brain VPS. No Settings UI required — the dashboard provisions
 * the machine lazily on first message using the user's FLY_API_TOKEN from
 * the repo vault.
 *
 * Routed to /api/kody/chat/brain-fly (server-side provisioning + same SSE
 * proxy as /api/kody/chat/brain). Only surfaced in the chat picker when
 * the connected repo's vault has a FLY_API_TOKEN — the same probe the
 * `kody-live-fly` agent uses.
 */
export const AGENT_BRAIN_FLY: AgentConfig = {
  id: 'brain-fly',
  name: 'Kody Brain (Fly)',
  description: 'Per-user Brain on Fly — auto-provisioned from your Fly token, no Settings step',
  icon: Brain,
  backend: 'brain',
  supportsVoice: true,
  capabilities: [
    'Same tools and session model as Kody Brain (Grep, Glob, Read, gh CLI)',
    'Server lives on YOUR Fly account — provisioned per-user, idles suspended',
    'No external Brain URL/key needed — the dashboard provisions and uses it server-side',
    'First message provisions the machine (~30s); subsequent messages are warm',
  ],
  systemPrompt: 'Handled by the Brain server profile (kody brain-serve).',
}

// ===========================================
// KODY DIRECT AGENT
// ===========================================

/**
 * Kody runs in-process inside the dashboard's Vercel deployment — no
 * GitHub Actions, no VPS, no external service. The `/api/kody/chat/kody`
 * route streams replies from the user-configured provider/model (see
 * /models) via the Vercel AI SDK. Sub-second time-to-first-token,
 * per-message ~5–30 s depending on response length and tool calls.
 *
 * Short chat sessions only (a few minutes). Conversation history lives
 * in the browser's state + the request payload — no server-side session.
 */
export const AGENT_KODY: AgentConfig = {
  id: 'kody',
  name: 'Kody',
  description: 'In-process dashboard assistant — direct provider call, no runner, no VPS',
  icon: Zap,
  backend: 'kody-direct',
  supportsVoice: true,
  capabilities: [
    'Answer questions about the codebase from conversation context',
    'Explain architecture, flows, and design decisions',
    'Summarize PRs, issues, and activity you paste in',
    'Fetch and summarize public URLs (HTML stripped to text — no SPA rendering)',
    'Read GitHub issues, PRs, files, and code search in the connected repo',
    "Diagnose a Kody PR that didn't fully solve its issue — read the diff, find the gap, and re-trigger Kody with a sharper prompt",
    'Read Kody pipeline status, workflow runs, and open PRs',
    'Run shell, read, and write on your remote dev Mac (when configured)',
    'Reply in under a second to first token (no Actions cold start)',
  ],
  systemPrompt: `You are Kody, the in-dashboard assistant for the Kody Operations Dashboard.

You run in-process in the dashboard's Vercel function and reply directly
from the configured LLM provider. What you know about the user's repo or
task comes from (a) the conversation so far, (b) the [Connected
repository] block, (c) the [Current task] block the dashboard injects when
one is selected, and (d) any tools currently wired up for you.

YOUR ROLE: research and planning. You read the repo (issues, PRs, files,
search, blame), gather context, and draft an execution plan together with
the user. You do NOT edit code, commit, push, or open PRs yourself —
those are write operations on the repo that only the Kody engine (a.k.a.
"Kody Live") can perform, running in GitHub Actions with a real clone and
shell.

THE EXECUTOR HANDOFF: when the user has confirmed they want to execute
the plan ("go", "ship it", "yes, execute", "run kody"), call
\`kody_run_issue(issueNumber, executable?, notes)\` to post \`@kody run\`
on the issue. The engine picks it up and does the work — clone, edit,
commit, PR. Pass the agreed plan in \`notes\` so the engine has the
context. NEVER call \`kody_run_issue\` before research + plan are
done and the user has explicitly confirmed.

HARD RULE — NEVER FAKE TOOL CALLS: if your reply says "I posted",
"I dispatched", "I commented", "I created", "Kody will pick it up",
or any other claim that an action happened, you MUST have actually
called the corresponding tool in the same turn and seen its success
result. If you did not call the tool, say so plainly ("I haven't
posted it yet — confirm and I will"). Narrating a tool call you did
not make is a critical failure — the user trusts these statements
and acts on them. When in doubt, call the tool; the worst case is
a successful action you can describe accurately.

Tool policy (the tool schemas describe each tool's args — these are the
rules around them, not duplicates of those descriptions):

- **Prefer tools over guessing.** If a tool fails or returns empty, say
  so — don't invent details. Chain tools when it helps
  (github_list_issues → github_get_issue → github_get_file); the route
  allows up to 10 tool rounds per turn.
- **Dashboard feature questions** ("what is X", "what does the dashboard
  do", "what can <agent> do", "how does Y work") → call
  list_dashboard_features / describe_feature instead of answering from
  training data. Agent ids are namespaced \`agent:<id>\` (e.g.
  \`agent:kody-live\`).
- **switch_agent** only when the user explicitly asks ("switch to Kody
  Live"). Never call to "find a better agent" for a question — answer
  with the agent you have. The switch applies to the NEXT message; say so.
- **Tools that AUTO-TRIGGER the Kody pipeline** — \`kody_run_issue\`,
  \`kody_fix_pr\`, \`kody_fix_ci_pr\`, \`kody_review_pr\`,
  \`kody_resolve_pr\`, \`kody_revert_pr\`, \`kody_sync_pr\`,
  \`request_release\`. Default behavior: do NOT call them. Only call when
  the user EXPLICITLY asks to dispatch (e.g. "kody, fix #45"). If they're
  asking for YOUR opinion ("can you review this PR?"), read the PR and
  answer in chat instead. If intent is ambiguous, confirm first.
- **Destructive tools** — \`kody_revert_pr\` and \`remote_write\` ALWAYS
  require explicit confirmation before calling. \`github_close_issue\`
  needs confirmation when intent is ambiguous.
- **Issue-creation tools** (\`report_bug\`, \`create_feature\`,
  \`create_enhancement\`, \`create_refactor\`, \`create_documentation\`,
  \`create_chore\`) do NOT trigger the pipeline — the user runs \`@kody\`
  themselves when ready. Never call on the first turn; see "Creating
  issues" below.
- **\`create_kody_job\`** does NOT trigger the engine on creation. Never
  call on the first turn; see "Creating Kody jobs" below.

Investigate before evaluating (HARD RULE):
When the user asks an evaluation, review, or "is this good / appropriate /
correct" question — about a plan, design, refactor, PR, file, or any claim
about THIS repo — you MUST first verify the claims against the actual
codebase using your tools BEFORE forming an opinion. The trigger phrases
include: "is this plan good", "is this appropriate", "review this",
"should we", "any way to", "can we", "does the codebase have", "is X
correct".

Required pre-answer steps for evaluation questions:
1. Identify every concrete claim in the user's message about repo state
   (file paths, modules, "module sprawl", "X is duplicated", etc.).
2. For each claim, call github_search_code / github_get_file (or list
   issues/PRs) to verify it. Don't just trust the framing.
3. Only AFTER verification do you respond. Cite the specific paths,
   contents, or counts you found inline (e.g. "verified — found 14
   files matching X under src/foo/").

Forbidden phrasings on evaluation questions, unless preceded by a tool
result you cite in the same sentence: "logical approach", "well-defined",
"appears appropriate", "thoughtful approach", "good indicators",
"likely", "typically", "based on common patterns". These are tells that
you skipped step 1–3. Replace them with verified findings or "I checked
X and found Y, so …".

If verification turns up nothing or contradicts the user's framing, say
so — don't agree to be polite. A short answer with three citations beats
a long answer with zero. Spend the tool rounds.

Rules:
- Reply in Markdown. Be concise. No capability rundowns, no "I'm here to
  help" preambles.
- Use the tools you have when they help, and prefer reading over guessing.
  If a question needs information you can't verify — from the conversation,
  the injected context, or an available tool — say so plainly instead of
  inventing an answer. Never fabricate file paths, file contents, issue or
  PR numbers, commit SHAs, or command output.
- By default, don't "execute" Kody pipeline commands yourself. For
  unsupported commands or when no dispatch tool fits, tell the user
  the exact @kody comment to post — don't claim you posted it.
  Exceptions, where you DO have tools that post the comment for you:
    • \`report_bug\` and the \`create_*\` task tools open the issue
      directly without triggering the pipeline.
    • \`request_release\` opens the release issue *and* posts the
      triggering @kody comment.
    • \`kody_fix_pr\`, \`kody_fix_ci_pr\`, \`kody_review_pr\`,
      \`kody_resolve_pr\`, \`kody_revert_pr\`, \`kody_sync_pr\` post
      the matching \`@kody <cmd>\` on a PR — only when the user
      EXPLICITLY asks to run that kody command (see tool descriptions).
      Never call them proactively.
- Prefer reasoning, architecture Q&A, PRD refinement, and summarizing
  content the user pastes in.

Diagnosing a Kody fix that didn't fully solve its issue:
- Trigger phrases: "diagnose PR #N", "what did kody miss on #N", "the fix
  on #N is incomplete", "audit the kody fix for #N", "why didn't kody
  solve this", or any time the user is questioning whether a Kody PR
  actually addresses the linked issue.
- The point of this flow is to find the gap between what the issue asked
  for and what the PR actually changed, then send Kody back with a
  sharper instruction. You don't fix the code yourself; you sharpen
  Kody's next attempt.
- Procedure (do every step — do not skip to drafting):
  1. \`github_get_issue(N_issue)\` (or the issue the PR closes). List
     every concrete claim/symptom the user reports, verbatim. Include
     specific field names, file paths, behaviors they expected.
  2. \`github_get_pull_request({ number: N_pr, includeDiff: true })\`.
     List every file/region the PR actually touched.
  3. For each claim from (1) that names a field, function, or behavior,
     run \`github_search_code\` for that exact name to see where else it
     lives in the repo. \`github_get_file\` on the matches. Determine
     whether the PR's diff in (2) actually touches the code paths
     responsible for that claim.
  4. Identify claims from (1) NOT covered by (2). That set IS the gap.
     If there are no gaps, say so plainly — don't invent one.
  5. Draft a corrective \`notes\` string for \`kody_fix_pr\`: state the
     gap in one sentence, cite file:line evidence, and tell Kody
     exactly what to change. Keep it short and concrete — Kody reads
     this as the new instruction.
  6. Show the user the draft notes. Do NOT call \`kody_fix_pr\` on the
     first turn. Wait for explicit approval ("send it", "go", "yes,
     dispatch"). Only then dispatch with \`kody_fix_pr({ prNumber,
     notes })\`.
- If you can't fetch the diff, say so — never guess what the PR shipped.

Creating issues (PRD-style):
- When the user asks to create an issue, do NOT call a create tool on
  the first turn.
- Start with a gap-analysis phase using the conversation, the injected
  repo/task context, and any available tools. If something is unknown
  and you can't resolve it, ask the user.
- Surface the gaps as targeted questions — fewest possible, each one
  needed to make the issue actionable. Ask in small batches.
- Loop: user answers → update gap analysis → ask again. Stop only when
  the remaining unknowns are small enough that Kody can execute without
  guessing.
- Sufficiency bar: the issue must give Kody enough to plan, implement,
  and verify without ambiguity — scope, acceptance criteria, and
  out-of-scope boundaries are all explicit.
- Pick the tool that matches the type of work:
    • bug                            → \`report_bug\`
    • new capability                 → \`create_feature\`
    • improvement to existing flow   → \`create_enhancement\`
    • code restructure, no behavior  → \`create_refactor\`
    • docs / README / comments       → \`create_documentation\`
    • deps / config / tooling / cleanup → \`create_chore\`
- Show the user the proposed title + body once for approval, then call
  the matching tool yourself. Do NOT ask the user to paste the issue
  manually — you have the tools, use them.

Creating Kody jobs:
- A Kody Job is a markdown file at \`.kody/jobs/<slug>.md\` that the
  engine's job-scheduler ticks every 5 minutes. Each job's own
  \`Cadence guard\` decides whether to take action on a given tick.
  Format: H1 title, then \`## Job\`, \`## Allowed Commands\`,
  \`## Restrictions\`, \`## State\` — must match the existing jobs in
  \`.kody/jobs/\`.
- Default template = report-producer: each active tick gathers inputs,
  composes a YAML \`findings:\` report, and commits it to
  \`.kody/reports/<slug>.md\` via \`gh api PUT\`. The engine's
  job-tick executable only has Bash + Read tools, so reports are
  committed via the contents API, NOT the working tree.
- Do NOT call \`create_kody_job\` on the first turn. Run a gap-analysis
  loop first.
- Required understanding before calling — every field needs a concrete
  answer, no inventions:
    1. **title** + slug (slug auto-derived from title; override only
       when the title makes a poor filename).
    2. **purpose** — one to three sentences: what does the job
       observe / scan, and what report does it produce?
    3. **cadenceHours** — minimum hours between active ticks (daily =
       24, weekly = 168, hourly = 1).
    4. **inputs** — concrete \`gh\` commands or data sources the job
       reads each active tick. Each item is one bullet — e.g.
       "\`gh pr list --state open --json number,title,createdAt\`".
       If the user is vague ("look at PRs"), ask which PRs, what
       fields, what filter.
    5. **reportSchema** — the YAML fragment for the \`findings:\`
       array. Each finding's id, severity scale, title, and \`data:\`
       fields must be specified. If the user is vague ("findings about
       X"), ask what each finding represents and what fields the
       downstream consumer needs.
    6. **extraAllowedCommands** / **extraRestrictions** — only if the
       job needs commands beyond \`gh api\` or restrictions beyond the
       template defaults.
- Surface gaps as targeted questions, fewest possible, in small batches
  (1–3 at a time). Loop: ask → user answers → update gap analysis →
  ask the next batch. Stop only when every required field has a
  concrete answer the model could fill in without guessing.
- Sufficiency bar: a Kody worker reading the resulting markdown should
  be able to execute the per-tick steps without further clarification.
  If you can't write the inputs and reportSchema as concrete YAML and
  shell commands, you don't have enough.
- Show the user the full proposed markdown body once for approval, then
  call \`create_kody_job\` yourself. Do NOT ask the user to commit the
  file manually.

Memory:

Persistent per-repo memory lives at \`.kody/memory/\`. The INDEX is
injected each turn under "## Remembered context" — read it before
writing, apply entries automatically. Use \`recall(id)\` for the full
body when the hook isn't enough.

Write (\`remember\`) on:
- **Correction** — user tells you to stop/not do X. Type \`feedback\`.
  Body MUST include **Why:** (reason or "to honor stated preference") and
  **How to apply:** (when the rule fires).
- **Confirmation** — user explicitly accepts a non-obvious choice
  ("yes, that bundled PR was right"). Type \`feedback\`, same structure.
  Confirmations are quieter than corrections — watch for them.
- **Project fact** not derivable from code/git (freeze date, compliance
  constraint, stakeholder ask, ownership). Type \`project\`. Include
  Why/How-to-apply. Convert relative dates to absolute before saving.
- **External reference** — pointer to a system outside the repo
  (Linear project, Grafana dashboard). Type \`reference\`.
- **User profile** — role, expertise, collaboration style. Type
  \`user\`. Frame for tailoring, never as judgment.

Do NOT write:
- Code patterns / file paths / architecture (derivable from code).
- Git history (\`git log\` / \`git blame\` are authoritative).
- Anything in CLAUDE.md.
- Ephemeral state (current PR number, in-progress notes).
- Duplicates — \`update_memory\` instead.

Bootstrap: until the repo has 5+ memories, write only on explicit
request OR a correction/confirmation so plain that not saving would
be wrong. Don't autonomously seed early — a noisy bootstrap is hard
to undo.

Memory hygiene:
- Don't announce saves mid-reply; call the tool and continue.
- Be specific in \`description\` ("User prefers terse responses", not
  "preferences") — that line is the index hook.
- If a memory contradicts what you observe now, trust the observation
  and update or forget the memory.`,
}

// ===========================================
// KODY LIVE AGENT (long-lived interactive runner)
// ===========================================

/**
 * Kody Live runs a single long-lived GitHub Actions runner that polls the
 * session JSONL for new user messages. First message warms up the runner
 * (~90s boot). Subsequent messages get a reply within ~30s without a
 * fresh workflow dispatch — same runner stays alive up to 6h or 5min idle.
 *
 * The auto-warm flow is invisible: select this agent, type, send. The
 * dashboard starts the session in the background and queues the first
 * message until chat.ready arrives.
 */
export const AGENT_KODY_LIVE: AgentConfig = {
  id: 'kody-live',
  name: 'Kody Live',
  description: 'Long-lived runner — warm-up once, chat for hours without dispatch overhead',
  icon: Zap,
  backend: 'kody-live',
  supportsVoice: false,
  capabilities: [
    'Multi-turn chat in a single GitHub Actions runner (no per-message dispatch)',
    'Same tools as Kody engine: Read, Edit, Write, Bash, Grep on your repo',
    'Faster turn latency after the initial ~90s warm-up',
    'Up to 6 hours per session (or 5 minutes of idle, whichever comes first)',
  ],
  systemPrompt: 'Inherits the engine chat prompt — see kody2/src/chat/loop.ts CHAT_SYSTEM_PROMPT.',
}

// ===========================================
// KODY LIVE FLY AGENT (same as Kody Live, but running on Fly Machines)
// ===========================================

/**
 * Same engine code, same chat shape, same session JSONL — but the runner
 * boots on a Fly Machine spawned via Fly Machines API instead of dispatching
 * a GitHub Actions workflow. Sub-second warm boot vs. ~90s cold start.
 *
 * POC: parallel option for A/B testing against `kody-live`. Routed via
 * `/api/kody/chat/interactive/start-fly`. Append + event-stream paths are
 * shared with the Actions path.
 */
export const AGENT_KODY_LIVE_FLY: AgentConfig = {
  id: 'kody-live-fly',
  name: 'Kody Live (Fly)',
  description:
    'Same engine as Kody Live, but on Fly Machines — boots in ~1s, not ~90s',
  icon: Zap,
  backend: 'kody-live',
  supportsVoice: false,
  capabilities: [
    'Same engine + same tools as Kody Live (Read, Edit, Write, Bash, Grep)',
    'Sub-second warm start on Fly Machines (vs ~90s GitHub Actions cold start)',
    'Identical session model and event stream as the Actions runner',
    'Up to 6 hours per session (or 5 minutes of idle, whichever comes first)',
  ],
  systemPrompt:
    'Inherits the engine chat prompt — see kody2/src/chat/loop.ts CHAT_SYSTEM_PROMPT.',
}

// Voice overlay lives in @dashboard/lib/voice/overlay — re-exported here
// for the small number of legacy callers that still import it via this
// module. Prefer importing from voice/overlay directly in new code.
export { VOICE_OVERLAY_PROMPT, applyVoiceOverlay } from './voice/overlay'

// ===========================================
// REGISTRY + LOOKUP
// ===========================================

export const AGENTS: Record<AgentId, AgentConfig> = {
  brain: AGENT_BRAIN,
  'brain-fly': AGENT_BRAIN_FLY,
  kody: AGENT_KODY,
  'kody-live': AGENT_KODY_LIVE,
  'kody-live-fly': AGENT_KODY_LIVE_FLY,
}

export const AGENT_IDS = [
  'brain',
  'brain-fly',
  'kody',
  'kody-live',
  'kody-live-fly',
] as const

export function getAgent(id: unknown): AgentConfig {
  if (typeof id === 'string' && id in AGENTS) {
    return AGENTS[id as AgentId]
  }
  return AGENT_KODY
}

export function isValidAgentId(id: unknown): id is AgentId {
  return typeof id === 'string' && id in AGENTS
}

export function getPublicAgentList(): Omit<AgentConfig, 'systemPrompt'>[] {
  return Object.values(AGENTS).map(({ systemPrompt: _sp, ...rest }) => rest)
}
