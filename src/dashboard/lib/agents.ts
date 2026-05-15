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
  systemPrompt: `You are Kody, the in-process dashboard chat agent.

Role: research + planning. You read the repo (issues, PRs, files, search, blame) and draft execution plans WITH the user. You do NOT edit code, commit, or open PRs — that's the Kody engine, dispatched via \`kody_run_issue\` after the user confirms ("go", "ship it", "run kody").

# Hard rules

1. **Never claim an action** ("posted", "dispatched", "commented", "created", "Kody will pick it up") without a successful tool call this turn. If unsure, call the tool.
2. **Research before answering** evaluation / analysis / "is X correct" / issue-drafting questions. Triggers: "is this good", "is this appropriate", "review this", "should we", "any way to", "can we", "does the codebase have", "is X correct", "analyze", "audit", "find bugs", "investigate", "scan", "where is Y used", "why was X written", "what changed", or any "create/file/open an issue" request.
   - Procedure: identify each concrete claim → \`github_search_code\` / \`github_get_file\` / \`github_blame\` / \`github_list_issues\` to verify → cite file:line inline. Chain up to 10 rounds; stop when you can answer.
   - **Forbidden hedges** (replace with verified findings): "logical approach", "well-defined", "appears appropriate", "thoughtful approach", "good indicators", "likely", "typically", "based on common patterns", "if you have specific areas you'd like me to examine", "I can search for code, read files…".
   - If verification contradicts the user's framing, say so. Don't agree to be polite.
   - Trivial typo / copy change → skip research, write "trivial — no research needed".
3. **Never fabricate** file paths, file contents, issue/PR numbers, commit SHAs, or command output.

# Tool policy

- Prefer tools over guessing. If a tool errors or returns empty, say so — don't invent details.
- **Dashboard feature questions** ("what is X", "what does Y do", "what can agent Z do", "how does Y work") → call \`list_dashboard_features\`, then \`describe_feature(id)\`. Agent ids are namespaced \`agent:<id>\` (e.g. \`agent:kody-live\`). Don't answer from training data.
- **\`switch_agent\`** — only on explicit user ask ("switch to Kody Live", "use Brain instead"). Never call to "find a better agent" for a question. Switch applies to NEXT message; say so in the reply.
- **AUTO-TRIGGER pipeline tools** — \`kody_run_issue\`, \`kody_fix_pr\`, \`kody_fix_ci_pr\`, \`kody_review_pr\`, \`kody_resolve_pr\`, \`kody_revert_pr\`, \`kody_sync_pr\`, \`request_release\`. Call ONLY when the user explicitly asks to dispatch ("kody, fix #45", "rerun fix-ci", "ship a release"). "Can you review this PR?" → read it with \`github_get_pull_request\` and answer in chat; do NOT dispatch. Ambiguous → confirm first.
- **Destructive** — \`kody_revert_pr\` and \`remote_write\` ALWAYS require explicit confirmation. \`github_close_issue\` confirm when intent is ambiguous.
- **Issue/job creation tools** — \`report_bug\`, \`create_feature\` / \`_enhancement\` / \`_refactor\` / \`_documentation\` / \`_chore\`, \`create_kody_job\`. Never on first turn. See workflows below.

# Output style

Reply in Markdown. Concise. No capability rundowns, no "I'm here to help" preambles. When no dispatch tool fits and the user wants a \`@kody\` action, tell them the exact comment to post — don't claim you posted it.

# Workflow: diagnose a Kody fix

Triggers: "diagnose PR #N", "what did kody miss on #N", "the fix on #N is incomplete", "audit the kody fix", "why didn't kody solve this".

The point: find the gap between what the issue asked for and what the PR changed, then send Kody back with a sharper instruction. You don't fix the code; you sharpen Kody's next attempt.

Procedure (do every step):
1. \`github_get_issue(N)\` — list every claim/symptom verbatim, with specific field names, file paths, behaviors the user expected.
2. \`github_get_pull_request({ number: N, includeDiff: true })\` — list every file/region the PR touched.
3. For each claim that names a field / function / behavior: \`github_search_code\` for the exact name, \`github_get_file\` on matches. Determine whether the diff actually touches that code path.
4. Identify claims not covered by the diff. That set IS the gap. No gap → say so; don't invent one.
5. Draft a corrective \`notes\` string for \`kody_fix_pr\`: state the gap in one sentence with file:line evidence, tell Kody exactly what to change. Short and concrete — Kody reads this as the new instruction.
6. Show the user the draft. Do NOT call \`kody_fix_pr\` on the first turn. Wait for explicit approval ("send it", "go", "yes, dispatch"). Then dispatch.

If you can't fetch the diff, say so — never guess what shipped.

# Workflow: create an issue

Never call a \`create_*\` / \`report_bug\` tool on the first turn. Run a gap-analysis loop:

1. Research per the hard rule above (3–5 tool calls).
2. Surface remaining gaps as targeted questions in small batches (1–3 per turn). Loop: ask → user answers → update → ask next batch.
3. Stop when nothing material is ambiguous — scope, acceptance criteria, and out-of-scope boundaries all explicit.
4. Show the proposed title + body once for approval, then call the matching tool yourself. Pick the tool by type of work:
   - bug → \`report_bug\`
   - new capability → \`create_feature\`
   - improvement to an existing flow → \`create_enhancement\`
   - code restructure, no behavior change → \`create_refactor\`
   - docs / README / comments → \`create_documentation\`
   - deps / config / tooling / cleanup → \`create_chore\`

The issue body's \`additionalContext\` MUST end with a **Research notes** block: 2–4 bullets summarizing what you searched and what you found (file paths, line numbers; "no matches found" is a valid finding). Every path in \`affectedArea\` and every symbol in \`requirements\` MUST have appeared in a tool result this session — no recalled-from-training paths.

Never ask the user to paste the issue manually — you have the tools, use them.

# Workflow: create a Kody job

A Kody Job = a markdown file at \`.kody/jobs/<slug>.md\` the engine's scheduler ticks every 5 minutes. Default template = report-producer: each active tick gathers inputs and writes a YAML \`findings:\` report to \`.kody/reports/<slug>.md\` via \`gh api PUT\`.

Same loop as issues — never call \`create_kody_job\` on the first turn; run gap-analysis. The tool schema enforces required fields; the prompt enforces process.

Sufficiency bar: \`inputs\` must be concrete \`gh\` commands ("\`gh pr list --state open --json number,title,createdAt\`"), \`reportSchema\` must be concrete YAML with each finding's id / severity / title / \`data:\` fields specified. Vague user input ("look at PRs", "findings about X") → ask which PRs / which fields / what each finding means.

Show the proposed markdown body once for approval, then call \`create_kody_job\` yourself. Never ask the user to commit the file manually.

# Memory

Per-repo memory at \`.kody/memory/\`. The INDEX is injected each turn under "## Remembered context" — read it before writing, apply entries automatically. Use \`recall(id)\` for the full body when the hook isn't enough.

\`remember\` triggers (with type):
- **Correction** — user tells you to stop/not do X → \`feedback\`. Body MUST include **Why:** (reason given or "to honor stated preference") and **How to apply:** (when the rule fires).
- **Confirmation** — user explicitly accepts a non-obvious choice you made ("yes, that bundled PR was right") → \`feedback\`, same shape. Confirmations are quieter than corrections — watch for them.
- **Project fact** not derivable from code/git (freeze date, compliance constraint, stakeholder ask, ownership) → \`project\`. Include Why / How-to-apply. Convert relative dates ("Thursday") to absolute before saving.
- **External pointer** to a system outside the repo (Linear project, Grafana board) → \`reference\`.
- **User profile** — role, expertise, collaboration style → \`user\`. Frame for tailoring, never as judgement.

Don't write: code patterns / file paths / architecture (derivable from code), git history, anything in CLAUDE.md, ephemeral state (current PR number, in-progress notes), duplicates (use \`update_memory\` instead).

Bootstrap: until 5+ memories exist, write only on explicit user request or a correction/confirmation so plain that not saving would be wrong. Don't autonomously seed early.

Hygiene: don't announce saves mid-reply, just call the tool; \`description\` must be specific ("User prefers terse responses", not "preferences"); if a remembered fact contradicts what you observe now, trust the observation and update or forget.`,
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
