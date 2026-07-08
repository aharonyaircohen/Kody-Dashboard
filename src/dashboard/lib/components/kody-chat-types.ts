/**
 * @fileType data
 * @domain kody
 * @pattern kody-chat-types
 * @ai-summary Shared types + small converters for KodyChat: the UI-facing
 *   `Message`/`ToolCall`/`Attachment` shapes, the `KodyChatProps` contract,
 *   the `ChatMessage` ⇄ `Message` converters, and the set of issue-creation
 *   tool names the in-process chat path watches for.
 */

import type { AttachmentRef, ChatContext, ChatMessage } from "../chat-types";
import type { AgentId } from "../agents";
import type { GoalRef } from "../chat/plugins/goals";
import type { ChatViewDirective } from "@dashboard/lib/chat-ui-actions";
import type { ChatCapabilityGrant, ChatPlugin } from "../chat/platform";

export interface Message {
  role: "user" | "assistant";
  content: string;
  isLoading?: boolean;
  timestamp?: string;
  toolCalls?: Array<{
    /** Optional SDK tool_use id — used to pair results back to calls. */
    id?: string;
    name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
    status: "running" | "success" | "error";
    durationMs?: number;
    /**
     * Human-readable description of the tool (the same string the model uses
     * to decide whether to call it). Populated for Kody Direct turns from the
     * `data-tools-index` event the route emits at the start of the stream;
     * absent for Brain/Engine chats until their streams are updated to
     * populate the same slot.
     */
    description?: string;
  }>;
  /** Attachment refs (blobs live in IndexedDB). */
  attachments?: AttachmentRef[];
  /**
   * Marks a synthetic "Error: …" message produced by the chat client when
   * a request fails. These are visible in the UI but MUST be filtered out
   * of the transcript sent back to the model — otherwise the next turn
   * sees a fake assistant reply describing an old failure and tries to
   * "respond" to it (e.g. apologizing for a stale KODY_MASTER_KEY
   * misconfig). Always paired with role: 'assistant'.
   */
  isError?: boolean;
  /**
   * Synthetic user turn the dashboard injects after a successful
   * `preview_act` so the model sees the post-action DOM snapshot.
   * Hidden in the UI (no bubble) but still sent on the wire so the
   * model can chain steps. Distinct from `isError`: not an error,
   * just not for the user's eyes.
   */
  hidden?: boolean;
  view?: ChatViewDirective;
}

/**
 * Convert ChatMessage (from session storage) to Message (UI)
 */
export function chatToMessage(chat: ChatMessage): Message {
  return {
    role: chat.role,
    content: chat.text,
    timestamp: chat.timestamp,
    toolCalls: chat.toolCalls,
    isLoading: chat.isLoading,
    attachments: chat.attachments,
    hidden: chat.hidden,
    view: chat.view,
  };
}

/**
 * Convert Message (UI) to ChatMessage (for session storage)
 */
export function messageToChat(msg: Message): ChatMessage {
  return {
    role: msg.role,
    text: msg.content,
    timestamp: msg.timestamp || new Date().toISOString(),
    toolCalls: msg.toolCalls,
    isLoading: msg.isLoading,
    attachments: msg.attachments,
    hidden: msg.hidden,
    view: msg.view,
  };
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status: "running" | "success" | "error";
  startedAt?: number;
  durationMs?: number;
  /**
   * Human-readable description of the tool (the same string the model uses
   * to decide whether to call it). Populated for Kody Direct turns from the
   * `data-tools-index` event the route emits at the start of the stream;
   * absent for Brain/Engine chats until their streams are updated to
   * populate the same slot.
   */
  description?: string;
}

export interface Attachment {
  /** IndexedDB record id — used to look up the blob on send/render. */
  id: string;
  name: string;
  type: string;
  size: number;
  /** Base64 data URL kept in memory for the live composer preview + send. */
  data: string;
  mimeType: string;
}

export interface KodyChatProps {
  /**
   * What this chat is "about". Today only task-scoped chat is supported;
   * the discriminated union leaves room for other kinds (e.g. capability
   * drafting) to be added in later phases without touching every access
   * site in this component.
   *
   * `null`/`undefined` = global chat (no scoped context).
   */
  context?: ChatContext | null;
  /** GitHub login of the current user — used for remote dev status */
  actorLogin?: string | null;
  /** Optional close handler — when set, renders a close `×` in the header (mobile sheet). */
  onClose?: () => void;
  /**
   * Collapse the desktop chat rail to a strip. When set, the header
   * renders a collapse button (desktop only — the mobile sheet uses
   * `onClose` instead).
   */
  onCollapseRail?: () => void;
  /**
   * Toggle the desktop chat rail between its normal width and
   * fullscreen. When set, the header renders an expand/restore button.
   */
  onToggleFullscreen?: () => void;
  /** Whether the rail is currently fullscreen — picks the expand icon. */
  railFullscreen?: boolean;
  /**
   * Force a specific agent and hide the picker. Used by the Vibe page,
   * which is always Kody Live. When set, the chevron + dropdown are
   * suppressed and the brain auto-default logic is skipped.
   */
  lockedAgentId?: AgentId;
  /**
   * Vibe mode — keeps chat focused on research, planning, and issue creation
   * for the Vibe page. Execution is owned by the Vibe page workflow, which
   * calls `/api/kody/vibe/execute` for the selected issue.
   */
  vibeMode?: boolean;
  /**
   * Fired when an issue-creation tool (`create_feature`, `create_enhancement`,
   * `create_refactor`, `create_documentation`, `create_chore`, `report_bug`)
   * completes with a new GitHub issue number. The chat has *already* migrated
   * the running conversation to that issue's chat store by the time this
   * fires — the host typically just navigates (e.g. `setSelectedIssueNumber`
   * on the Vibe page) so the user lands on the new issue and sees the
   * transferred history.
   */
  onIssueCreated?: (issueNumber: number) => void;
  /**
   * Goals the user can "direct chat to" by typing the goal's
   * `#<discussionNumber>` (or `goal:<n>`) in the composer. Supplied by
   * ChatRailShell from the live goals list.
   */
  knownGoals?: GoalRef[];
  /**
   * Re-scope the chat to the given goal's planner. Fired when the user
   * mentions a known `goal:<id>` token; the host (ChatRailShell) builds
   * the `goal-planner` ChatContext and pushes it back down via `context`.
   */
  onDirectToGoal?: (goalId: string) => void;
  /**
   * A context chip to attach to the composer when `id` changes. Used by the
   * preview element picker: `label` shows as a removable pill above the input
   * (e.g. `<button#submit>`), `context` is the full block appended to the
   * outgoing message on send (so the input stays clean). The `id` makes this
   * idempotent across re-renders — same id is a no-op, a new id adds one chip.
   */
  composerInjection?: { id: string; label: string; context: string } | null;
  /**
   * Attach an image to the composer when `id` changes (e.g. a preview
   * screenshot from the element picker). Added to the chat's attachment list
   * as if the user had dropped the file. `id` makes it idempotent. Pass `null`
   * to clear.
   */
  attachmentInjection?: {
    id: string;
    name: string;
    dataUrl: string;
    mimeType: string;
  } | null;
  /**
   * Ambient preview context supplied by the page shell. Used by the standalone
   * Preview workspace so uploaded static pages are understood by chat even
   * before the inspector extension can return a live DOM snapshot.
   */
  previewContext?: string | null;
  /** Where the chat is mounted. `standalone` keeps the client route borderless. */
  presentation?: "rail" | "standalone";
  /**
   * Presentation-only: hide the terminal mode switch for chat-only surfaces.
   * Admin dashboard chat leaves this unset.
   */
  hideTerminalMode?: boolean;
  /**
   * Chat plugins to register into this mount's registry (plan H4: one
   * registry per KodyChat instance — plugin manifests are global pure data,
   * instantiation is per mount). Mount-time config: the list is read once
   * when the mount's registry is created. Default: no plugins — the surface
   * renders exactly as before the platform existed.
   */
  plugins?: Array<{ plugin: ChatPlugin }>;
  /**
   * Capability grant applied when registering `plugins`. Defaults to
   * `FULL_GRANT` (the admin surface composes everything). Grants gate
   * client-side composition only — not a security boundary (plan M6).
   */
  capabilityGrant?: ChatCapabilityGrant;
}

/**
 * Tools that, on success, return `{ number: <issue#>, ... }`. When any of
 * these completes in the in-process chat path, the surrounding chat
 * transfer logic kicks in (see `pendingCreatedIssue` in `sendText`).
 */
export const ISSUE_CREATION_TOOL_NAMES = new Set<string>([
  "create_task",
  "create_feature",
  "create_enhancement",
  "create_refactor",
  "create_documentation",
  "create_chore",
  "report_bug",
]);

export function getCreatedIssueNumberFromToolOutput(
  toolName: string | undefined,
  output: unknown,
): number | null {
  if (!toolName || !ISSUE_CREATION_TOOL_NAMES.has(toolName)) {
    return null;
  }
  if (!output || typeof output !== "object" || !("number" in output)) {
    return null;
  }

  const number = (output as { number?: unknown }).number;
  return typeof number === "number" && Number.isInteger(number) && number > 0
    ? number
    : null;
}
