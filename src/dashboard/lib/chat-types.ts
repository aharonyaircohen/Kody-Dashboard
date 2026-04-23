/**
 * @fileType types
 * @domain kody | dashboard
 * @pattern chat-persistence
 * @ai-summary Shared types for chat persistence across dashboard and pipeline
 */

/**
 * A single message in a chat conversation.
 * Used for both dashboard chat and pipeline agent sessions.
 */
export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  tools?: string[]
  timestamp: string
  model?: string
  /** Tool calls associated with this message (for tool visibility feature) */
  toolCalls?: Array<{
    name: string
    arguments: Record<string, unknown>
    result?: unknown
    status: 'running' | 'success' | 'error'
    durationMs?: number
  }>
  /**
   * True while a reply is being streamed into this message. Persisted so the
   * UI→storage→UI round-trip preserves the in-flight marker; without this,
   * streaming updates can't find the placeholder to append chunks to.
   */
  isLoading?: boolean
}

/**
 * A session of chat messages.
 * For dashboard: a continuous conversation in task mode.
 * For pipeline: one agent stage execution.
 */
export interface ChatSession {
  /** Session type: 'dashboard' for user conversations, or pipeline stage name */
  stage: string
  /** OpenCode session ID (for pipeline sessions) */
  sessionId?: string
  /** When this session started */
  startedAt: string
  /** Messages in this session */
  messages: ChatMessage[]
}

/**
 * Complete chat history for a task.
 * Stored in .tasks/<taskId>/chat.json
 */
export interface ChatHistory {
  /** Schema version */
  version: 1
  /** Task ID this chat belongs to */
  taskId: string
  /** All sessions (pipeline + dashboard) */
  sessions: ChatSession[]
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
  id: string
  /** User-editable or auto-generated title */
  title: string
  /** When this session was created */
  createdAt: string
  /** Last message timestamp */
  updatedAt: string
  /** Number of messages in this session */
  messageCount: number
  /** Whether this session is pinned */
  pinned?: boolean
}

/**
 * localStorage structure for global (non-task) chat sessions.
 * Replaces the v1 format (simple Message[] per agent).
 */
export interface GlobalChatStore {
  /** Schema version */
  version: 3
  /** Session metadata list */
  sessions: SessionMeta[]
  /** Messages keyed by session ID */
  messages: Record<string, ChatMessage[]>
  /** Active session ID (single, not per-agent) */
  activeSessionId: string
}

/**
 * Default empty global chat store
 */
export function createEmptyGlobalStore(): GlobalChatStore {
  return {
    version: 3,
    sessions: [],
    messages: {},
    activeSessionId: '',
  }
}
