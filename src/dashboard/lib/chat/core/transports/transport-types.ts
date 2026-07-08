/**
 * @fileType module
 * @domain chat-platform
 * @pattern transport-contract
 * @ai-summary ChatTransport contract (plan H1), finalized in Step 2c when
 *   the three adapters landed: kody-direct (client tool loop), brain
 *   (server-stateful SSE), kody-live (engine runner lifecycle). Lives in
 *   core (the lint zones forbid core → platform imports);
 *   chat/platform/transport.ts re-exports it as the public surface. The
 *   surface consumes ChatEvents; directives are events the SURFACE
 *   interprets, so router/toast/flushSync never enter core.
 */

import type {
  DashboardNavigateDirective,
  PreviewActDirective,
  RenderedViewDirective,
  SwitchAgentDirective,
} from "../../../chat-ui-actions";

/**
 * Directives the surface interprets (never executed inside core). Each
 * carries the untouched wire payload — adapters decide WHAT to emit
 * (shape detection via chat-ui-actions guards); the surface decides HOW
 * to react (router push, agent flip, preview-act chaining, view render).
 */
export type ChatDirective =
  | { kind: "switch-agent"; payload: SwitchAgentDirective }
  | { kind: "dashboard-navigate"; payload: DashboardNavigateDirective }
  | { kind: "preview-act"; payload: PreviewActDirective }
  | { kind: "rendered-view"; payload: RenderedViewDirective };

export type ChatTransportStatus =
  | "idle"
  | "connecting"
  | "streaming"
  | "waiting-runner"
  | "restoring";

/**
 * The event union every transport emits. One shape for all three protocol
 * families so the reducer/surface never branch on backend identity.
 *
 * Family notes:
 * - kody-direct streams deltas (`token`/`reasoning`) plus `text-replace`
 *   for the final_answer tool (which supersedes streamed text).
 * - brain replays FULL message snapshots (`message`), not deltas — its
 *   server is stateful and resends the whole assistant text per event.
 * - `error.recoverable: true` = inline stream error appended to the
 *   transcript; `false` = terminal turn failure (error bubble).
 */
export type ChatEvent =
  | { type: "token"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "text-replace"; text: string }
  | {
      type: "message";
      role: "assistant" | "user" | "system";
      /** Full snapshot text. Absent when the wire event carried none. */
      content?: string;
      timestamp?: string;
    }
  | {
      type: "tool-call";
      /** SDK tool_use id — absent on backends that don't provide one (brain). */
      id?: string;
      toolName: string;
      input: unknown;
      /** Initial chip status. Brain reports completed calls (`success`). */
      status?: "running" | "success";
      description?: string;
      timestamp?: string;
    }
  | {
      type: "tool-result";
      id?: string;
      toolName?: string;
      /** Absent for stream-level tool errors (no output arrived). */
      output?: unknown;
      isError?: boolean;
      errorText?: string;
    }
  | { type: "directive"; directive: ChatDirective }
  | { type: "status"; status: ChatTransportStatus; detail?: string }
  | { type: "error"; message: string; recoverable: boolean; code?: string }
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
  /**
   * Adapter-specific turn config (endpoint, request body, lifecycle
   * knobs). Each adapter exports its config type; the caller builds it
   * with `satisfies` so the cast inside the adapter is checked at the
   * call site.
   */
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
