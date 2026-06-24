/**
 * @fileType types
 * @domain kody | dashboard
 * @pattern chat-persistence
 * @ai-summary Shared types for chat persistence across dashboard and pipeline
 */

/**
 * Reference to an attachment blob stored in IndexedDB.
 * Lives on a ChatMessage; the binary itself is in the `kody-attachments`
 * IDB store keyed by `id`. Cheap to round-trip through localStorage.
 */
export interface AttachmentRef {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

/**
 * A single message in a chat conversation.
 * Used for both dashboard chat and pipeline agent sessions.
 */
export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  tools?: string[];
  timestamp: string;
  model?: string;
  /** Tool calls associated with this message (for tool visibility feature) */
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
    status: "running" | "success" | "error";
    durationMs?: number;
  }>;
  /** Attachments uploaded with this user message (blobs in IndexedDB). */
  attachments?: AttachmentRef[];
  /**
   * True while a reply is being streamed into this message. Persisted so the
   * UI→storage→UI round-trip preserves the in-flight marker; without this,
   * streaming updates can't find the placeholder to append chunks to.
   */
  isLoading?: boolean;
}

/**
 * A session of chat messages.
 * For dashboard: a continuous conversation in task mode.
 * For pipeline: one agent stage execution.
 */
export interface ChatSession {
  /** Session type: 'dashboard' for user conversations, or pipeline stage name */
  stage: string;
  /** OpenCode session ID (for pipeline sessions) */
  sessionId?: string;
  /** When this session started */
  startedAt: string;
  /** Messages in this session */
  messages: ChatMessage[];
}

/**
 * Complete chat history for a task.
 * Stored in .tasks/<taskId>/chat.json
 */
export interface ChatHistory {
  /** Schema version */
  version: 1;
  /** Task ID this chat belongs to */
  taskId: string;
  /** All sessions (pipeline + dashboard) */
  sessions: ChatSession[];
}

// ===========================================
// SESSION MANAGEMENT TYPES (v2)
// ===========================================

/**
 * Lightweight session metadata for the session list UI.
 * Stored in localStorage alongside messages.
 */
export interface SessionMeta {
  /** Unique session identifier */
  id: string;
  /** User-editable or auto-generated title */
  title: string;
  /**
   * First user message, sliced. Used as the visible label while `title`
   * is still the "New conversation" placeholder (the async LLM auto-title
   * may not have resolved, or the session never completed an exchange).
   * Purely cosmetic — the LLM auto-title effect remains the title owner.
   */
  preview?: string;
  /** When this session was created */
  createdAt: string;
  /** Last message timestamp */
  updatedAt: string;
  /** Number of messages in this session */
  messageCount: number;
  /** Whether this session is pinned */
  pinned?: boolean;
  /**
   * The chat entry key (from `buildAgentList` — e.g. `"brain"`,
   * `"kody:claude-sonnet"`, `"kody-live"`) the user picked for THIS
   * session. Per-session so switching conversations remembers each
   * thread's chosen assistant instead of a single global default.
   *
   * `undefined` for legacy sessions created before this field existed —
   * render-time fallback to the global `defaultChatEntryKey` (then the
   * brain auto-default, then `kody-live`) applies. The next time the
   * user picks an agent in that session, the field is populated.
   */
  agentKey?: string;
  /** Ephemeral UI status derived from the stored messages */
  status?: "idle" | "running";
}

/**
 * localStorage structure for global (non-task) chat sessions.
 * Replaces the v1 format (simple Message[] per agent).
 */
export interface GlobalChatStore {
  /** Schema version */
  version: 3;
  /** Session metadata list */
  sessions: SessionMeta[];
  /** Messages keyed by session ID */
  messages: Record<string, ChatMessage[]>;
  /** Active session ID (single, not per-agent) */
  activeSessionId: string;
}

/**
 * Default empty global chat store
 */
export function createEmptyGlobalStore(): GlobalChatStore {
  return {
    version: 3,
    sessions: [],
    messages: {},
    activeSessionId: "",
  };
}

/**
 * Discriminated union describing what the chat is "about".
 *
 * `null`/absent prop on KodyChat = global chat (no scoped context).
 */
export type ChatContext =
  | {
      /**
       * Chat scoped to a GitHub owner workspace in the dashboard.
       * Broad reads can span repos; writes must still target a concrete repo.
       */
      kind: "org";
      org: string;
      repositories?: Array<{ owner: string; repo: string }>;
    }
  | { kind: "task"; task: import("./types").KodyTask }
  | {
      /**
       * Chat scoped to an existing agentResponsibility (or agent — an agent
       * is a pure agent file that's structurally a subset of a agentResponsibility and
       * reuses this scope kind). The agent is given the title/body so
       * it can answer questions about that specific agentResponsibility/agents.
       */
      kind: "agentResponsibility";
      agentResponsibility: import("./api").AgentResponsibility | import("./api").Agent;
    }
  | {
      /**
       * Chat scoped to planning a single Goal. The agent decomposes the
       * goal description into a task list (Pass 1, text-only) and, after
       * user approval, creates GitHub issues attached to the goal via
       * `create_task_for_goal` (Pass 2). See system-prompt's "Goal
       * planning mode" block for the full workflow.
       */
      kind: "goal-planner";
      goal: import("./api").Goal;
      /** Stable id for this planner chat session (for keyed message stores). */
      sessionId: string;
      /**
       * Snapshot of tasks already attached to the goal — passed into the
       * system prompt so the planner doesn't propose duplicates. Optional;
       * caller may omit when no tasks exist yet.
       */
      existingTasks?: Array<{ number: number; title: string; state?: string }>;
      /**
       * Fired after the planner creates one or more tasks so the host page
       * can refresh its task list. Optional.
       */
      onTasksCreated?: () => void;
      /**
       * Fired when the user wants to exit planner mode (e.g. clicks the X
       * in the chat's "Planning" badge). The host should clear its
       * `planningGoal` state so the chat falls back to its normal
       * task/global context.
       */
      onExit?: () => void;
    }
  | {
      /**
       * Chat scoped to a system report (a markdown file at
       * `reports/<slug>.md` in the configured Kody state repo, surfaced on `/reports`).
       * The agent receives the report's title + body and is framed to
       * advise whether the user should: (a) create an issue from this report,
       * (b) attach it to a goal, or (c) take no action — sometimes a report
       * is informational and needs no follow-up.
       */
      kind: "report";
      report: { slug: string; title: string; body: string };
    };
