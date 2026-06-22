/**
 * @fileType config
 * @domain kody
 * @pattern agent-config
 * @ai-summary Single unified agent definition for Kody chat
 */

import { Brain, Zap, type LucideIcon } from "lucide-react";

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
export type ChatBackend = "kody-engine" | "brain" | "kody-direct" | "kody-live";

export type AgentId =
  | "brain"
  | "brain-fly"
  | "kody"
  | "kody-live"
  | "kody-live-fly";

/**
 * True for agents that use the long-lived "interactive runner" flow
 * (poll-based session JSONL, /interactive/start + /interactive/append).
 * Both `kody-live` (GH Actions) and `kody-live-fly` (Fly Machines) share
 * the engine code and event-stream model — only the runtime differs.
 */
export function isLiveAgent(id: AgentId | string): boolean {
  return id === "kody-live" || id === "kody-live-fly";
}

export interface AgentConfig {
  id: AgentId;
  name: string;
  description: string;
  icon: LucideIcon;
  capabilities: string[];
  systemPrompt: string;
  backend: ChatBackend;
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
  supportsVoice: boolean;
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
`;

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
  id: "brain",
  name: "Kody Brain",
  description:
    "Claude-powered code research with a live repo checkout and session memory",
  icon: Brain,
  backend: "brain",
  supportsVoice: true,
  capabilities: [
    "Explore the repository with real Grep, Glob, and Read",
    "Follow code across files to answer architectural questions",
    "Remember context across turns within the same chat",
    "Run gh CLI for GitHub data (issues, PRs, workflows)",
    "Summarize and explain unfamiliar areas of the codebase",
  ],
  systemPrompt: "Handled by the Brain server profile.",
};

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
  id: "brain-fly",
  name: "Kody Brain (Fly)",
  description:
    "Per-user Brain on Fly — auto-provisioned from your Fly token, no Settings step",
  icon: Brain,
  backend: "brain",
  supportsVoice: true,
  capabilities: [
    "Same tools and session model as Kody Brain (Grep, Glob, Read, gh CLI)",
    "Server lives on YOUR Fly account — provisioned per-user, idles suspended",
    "No external Brain URL/key needed — the dashboard provisions and uses it server-side",
    "First message provisions the machine (~30s); subsequent messages are warm",
  ],
  systemPrompt: "Handled by the Brain server profile (kody brain-serve).",
};

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
  id: "kody",
  name: "Kody",
  description:
    "In-process dashboard assistant — direct provider call, no runner, no VPS",
  icon: Zap,
  backend: "kody-direct",
  supportsVoice: true,
  capabilities: [
    "Answer questions about the codebase from conversation context",
    "Explain architecture, flows, and design decisions",
    "Summarize PRs, issues, and activity you paste in",
    "Fetch and summarize public URLs (HTML stripped to text — no SPA rendering)",
    "Read GitHub issues, PRs, files, and code search in the connected repo",
    "Diagnose a Kody PR that didn't fully solve its issue — read the diff, find the gap, and re-trigger Kody with a sharper prompt",
    "Read Kody pipeline status, workflow runs, and open PRs",
    "Run shell, read, and write on your remote dev Mac (when configured)",
    "Reply in under a second to first token (no Actions cold start)",
  ],
  // The actual system prompt is composed at runtime from the chat-defaults
  // bundle (`@dashboard/lib/chat-defaults`). The agentIdentity + workflows + skills
  // + tool allowlist are data, not source. The string below is a placeholder
  // for any code path that still reads `agent.systemPrompt` directly — the
  // kody-direct route composes the real prompt via `composeBasePrompt(bundle)`.
  systemPrompt:
    "Kody — in-process dashboard chat agent. See chat-defaults bundle for the live prompt.",
};

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
  id: "kody-live",
  name: "Kody Live",
  description:
    "Long-lived runner — warm-up once, chat for hours without dispatch overhead",
  icon: Zap,
  backend: "kody-live",
  supportsVoice: false,
  capabilities: [
    "Multi-turn chat in a single GitHub Actions runner (no per-message dispatch)",
    "Same tools as Kody engine: Read, Edit, Write, Bash, Grep on your repo",
    "Faster turn latency after the initial ~90s warm-up",
    "Up to 6 hours per session (or 5 minutes of idle, whichever comes first)",
  ],
  systemPrompt:
    "Inherits the engine chat prompt — see kody2/src/chat/loop.ts CHAT_SYSTEM_PROMPT.",
};

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
  id: "kody-live-fly",
  name: "Kody Live (Fly)",
  description:
    "Same engine as Kody Live, but on Fly Machines — boots in ~1s, not ~90s",
  icon: Zap,
  backend: "kody-live",
  supportsVoice: false,
  capabilities: [
    "Same engine + same tools as Kody Live (Read, Edit, Write, Bash, Grep)",
    "Sub-second warm start on Fly Machines (vs ~90s GitHub Actions cold start)",
    "Identical session model and event stream as the Actions runner",
    "Up to 6 hours per session (or 5 minutes of idle, whichever comes first)",
  ],
  systemPrompt:
    "Inherits the engine chat prompt — see kody2/src/chat/loop.ts CHAT_SYSTEM_PROMPT.",
};

// Voice overlay lives in @dashboard/lib/voice/overlay — re-exported here
// for the small number of legacy callers that still import it via this
// module. Prefer importing from voice/overlay directly in new code.
export { VOICE_OVERLAY_PROMPT, applyVoiceOverlay } from "./voice/overlay";

// ===========================================
// REGISTRY + LOOKUP
// ===========================================

export const AGENTS: Record<AgentId, AgentConfig> = {
  brain: AGENT_BRAIN,
  "brain-fly": AGENT_BRAIN_FLY,
  kody: AGENT_KODY,
  "kody-live": AGENT_KODY_LIVE,
  "kody-live-fly": AGENT_KODY_LIVE_FLY,
};

export const AGENT_IDS = [
  "brain",
  "brain-fly",
  "kody",
  "kody-live",
  "kody-live-fly",
] as const;

export function getAgent(id: unknown): AgentConfig {
  if (typeof id === "string" && id in AGENTS) {
    return AGENTS[id as AgentId];
  }
  return AGENT_KODY;
}

export function isValidAgentId(id: unknown): id is AgentId {
  return typeof id === "string" && id in AGENTS;
}

export function getPublicAgentList(): Omit<AgentConfig, "systemPrompt">[] {
  return Object.values(AGENTS).map(({ systemPrompt: _sp, ...rest }) => rest);
}
