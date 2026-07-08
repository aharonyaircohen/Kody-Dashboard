/**
 * @fileType module
 * @domain chat-platform
 * @pattern transport-contract
 * @ai-summary ChatTransport contract (plan H1): every chat backend —
 *   kody-direct (client tool loop), brain (server-stateful SSE), kody-live
 *   (engine runner lifecycle) — implements this interface in Step 2c. The
 *   surface consumes ChatEvents; directives are events the SURFACE
 *   interprets, so router/toast/flushSync never enter core. Types only at
 *   Step 1; adapters + the zod event envelope land with Step 2c.
 */

/** Directives the surface interprets (never executed inside core). */
export type ChatDirective =
  | { kind: "dashboard-navigate"; path: string }
  | { kind: "switch-agent"; agentId: string; resendText?: string };

export type ChatTransportStatus =
  | "idle"
  | "connecting"
  | "streaming"
  | "waiting-runner"
  | "restoring";

/**
 * The event union every transport emits. One shape for all three protocol
 * families so the reducer/surface never branch on backend identity.
 */
export type ChatEvent =
  | { type: "token"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "message"; role: "assistant" | "system"; content: string }
  | { type: "tool-call"; id: string; toolName: string; input: unknown }
  | {
      type: "tool-result";
      id: string;
      toolName: string;
      output: unknown;
      isError?: boolean;
    }
  | { type: "directive"; directive: ChatDirective }
  | { type: "status"; status: ChatTransportStatus; detail?: string }
  | { type: "error"; message: string; recoverable: boolean }
  | { type: "done"; finishReason?: string };

export interface ChatAttachmentRef {
  name: string;
  mimeType: string;
  /** Data URL or upload reference — transport-specific resolution. */
  ref: string;
}

export interface ChatTurnInput {
  sessionId: string;
  text: string;
  agentId: string;
  modelId?: string;
  reasoningEffort?: string;
  attachments?: readonly ChatAttachmentRef[];
  /** Page/task context block the dashboard injects (pinned by e2e). */
  context?: Readonly<Record<string, unknown>>;
}

export interface ChatTransportContext {
  /** Auth headers (x-kody-token / x-kody-owner / x-kody-repo). */
  authHeaders: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  emit: (event: ChatEvent) => void;
}

/**
 * One transport per backend family. Lifecycle differences (brain's pinned
 * chat id, kody-live's runner states) live INSIDE the adapter — the
 * consumer sees only send/abort/probe.
 */
export interface ChatTransport {
  readonly id: string;
  send(input: ChatTurnInput, ctx: ChatTransportContext): Promise<void>;
  abort?(sessionId: string): void;
  /** Optional session-restore probing (kody-live reconnects). */
  probe?(sessionId: string, ctx: ChatTransportContext): Promise<void>;
}
