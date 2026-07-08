/**
 * @fileType module
 * @domain chat-platform
 * @pattern chat-transport-adapter
 * @ai-summary Kody-direct ChatTransport adapter (plan H1, Step 2c).
 *   Lifecycle model: client-driven tool loop — one stateless POST to
 *   /api/kody/chat/kody streaming Vercel AI SDK UI chunks as SSE. The
 *   adapter owns the SSE parse, the toolCallId→name / name→description
 *   bookkeeping, the final_answer text replacement, and directive shape
 *   detection (switch_agent / dashboard_navigate / preview_act /
 *   render_view) — emitting them as ChatEvents. The surface owns bubbles,
 *   the abort controller, and the post-stream directive application
 *   (including preview_act chaining into a synthetic follow-up turn).
 */

import { parseKodyDirectChunk, type KodyDirectChunk } from "./envelope";
import type { ChatTransport, ChatTransportContext } from "./transport-types";
import {
  isDashboardNavigateDirective,
  isPreviewActDirective,
  isRenderedViewDirective,
  isSwitchAgentDirective,
} from "../../../chat-ui-actions";
import {
  FINAL_ANSWER_TOOL,
  getToolErrorMessage,
  isFinalAnswerOutput,
} from "../../../chat-output-tools";

export interface KodyDirectTurnConfig {
  /** `/api/kody/chat/kody`. */
  endpoint: string;
  /**
   * The full request body (messages, task, agentId, voiceMode, vibeMode,
   * model, reasoningEffort, org/capability/report/goal context, …).
   * Assembled by the surface — it owns that state.
   */
  body: Readonly<Record<string, unknown>>;
}

function isKodyDirectTurnConfig(value: unknown): value is KodyDirectTurnConfig {
  if (!value || typeof value !== "object") return false;
  const cfg = value as Partial<KodyDirectTurnConfig>;
  return (
    typeof cfg.endpoint === "string" &&
    !!cfg.body &&
    typeof cfg.body === "object"
  );
}

/**
 * Run one kody-direct turn: POST the transcript, stream SSE chunks, emit
 * ChatEvents. HTTP failures and AbortErrors THROW (the surface owns its
 * historical catch semantics). Stream-level `error` chunks are emitted as
 * RECOVERABLE error events (they append to the visible text). The adapter
 * deliberately emits no `done` — the surface settles the bubble after
 * send() resolves, and its empty-turn fallback needs the loading flag
 * intact to find the bubble.
 */
export async function sendKodyDirectTurn(
  config: KodyDirectTurnConfig,
  ctx: ChatTransportContext,
): Promise<void> {
  const res = await fetch(config.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...ctx.authHeaders },
    signal: ctx.signal,
    body: JSON.stringify(config.body),
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    throw new Error(errText || `HTTP ${res.status}`);
  }

  // The kody route streams Vercel AI SDK UI messages as SSE
  // (`data: {json}\n\n`). Parse incrementally; the surface splits the
  // emitted deltas into its reasoning/text buffers.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let sseBuf = "";
  // Map of toolCallId → toolName, populated from `tool-input-available`
  // chunks so we can identify the source tool when its
  // `tool-output-available` arrives (the output chunk omits the name).
  const toolNameById = new Map<string, string>();
  // Map of toolName → human-readable description, hydrated from the
  // `data-tools-index` event the route emits at the start of the stream
  // (issue #321). One event per turn — not one per call — so this map is
  // small and stable for the lifetime of the turn.
  const toolDescriptionByName = new Map<string, string>();

  const applyChunk = (chunk: KodyDirectChunk): void => {
    if (chunk.type === "text-delta" && typeof chunk.delta === "string") {
      ctx.emit({ type: "token", text: chunk.delta });
    } else if (
      chunk.type === "reasoning-delta" &&
      typeof chunk.delta === "string"
    ) {
      ctx.emit({ type: "reasoning", text: chunk.delta });
    } else if (chunk.type === "error" && typeof chunk.errorText === "string") {
      // Inline stream error — the surface appends it to the transcript.
      ctx.emit({ type: "error", message: chunk.errorText, recoverable: true });
    } else if (
      chunk.type === "data-tools-index" &&
      chunk.data &&
      typeof chunk.data === "object"
    ) {
      // One name→description map for every tool in the merged tool set.
      // Each new tool chip looks its name up here so the thinking panel
      // can show the description the model saw when picking the tool.
      toolDescriptionByName.clear();
      for (const [name, desc] of Object.entries(chunk.data)) {
        if (typeof desc === "string" && desc.length > 0) {
          toolDescriptionByName.set(name, desc);
        }
      }
    } else if (
      // The AI SDK emits `tool-input-start` *before* it streams the input
      // deltas, and `tool-input-available` once the full input has been
      // parsed. Both carry the toolName for the same toolCallId — capture
      // from either, since `tool-input-available` can be skipped in some
      // edge cases (parse errors, providers that bypass delta streaming).
      // Without this fallback, the map miss leaves `name` undefined and
      // the issue-creation detection downstream silently no-ops.
      chunk.type === "tool-input-start" &&
      chunk.toolCallId !== undefined &&
      chunk.toolName !== undefined
    ) {
      toolNameById.set(chunk.toolCallId, chunk.toolName);
    } else if (
      chunk.type === "tool-input-available" &&
      chunk.toolCallId !== undefined &&
      chunk.toolName !== undefined
    ) {
      toolNameById.set(chunk.toolCallId, chunk.toolName);
      // final_answer is an output channel, not a visible tool — no chip.
      if (chunk.toolName === FINAL_ANSWER_TOOL) return;
      const toolInput =
        chunk.input && typeof chunk.input === "object"
          ? (chunk.input as Record<string, unknown>)
          : {};
      const description = toolDescriptionByName.get(chunk.toolName);
      // A "running" chip so the user sees live progress as the model
      // works — same UX as the kody-live runner path.
      ctx.emit({
        type: "tool-call",
        id: chunk.toolCallId,
        toolName: chunk.toolName,
        input: toolInput,
        status: "running",
        ...(description ? { description } : {}),
      });
    } else if (
      chunk.type === "tool-output-available" &&
      chunk.toolCallId !== undefined &&
      chunk.output !== undefined
    ) {
      const name = toolNameById.get(chunk.toolCallId);
      if (name === FINAL_ANSWER_TOOL) {
        // The final answer supersedes whatever streamed before it.
        if (isFinalAnswerOutput(chunk.output)) {
          ctx.emit({ type: "text-replace", text: chunk.output.content });
        }
        return;
      }
      const toolErrorText = getToolErrorMessage(chunk.output);
      if (toolErrorText) {
        // Errored tool outputs never carry directives — flag and stop.
        ctx.emit({
          type: "tool-result",
          id: chunk.toolCallId,
          ...(name !== undefined ? { toolName: name } : {}),
          output: chunk.output,
          isError: true,
          errorText: toolErrorText,
        });
        return;
      }
      // Any tool may emit a UI directive — match by shape, not by tool
      // name, so UI tools can remain thin. The surface defers application
      // until the stream settles (except render_view, applied inline).
      if (isSwitchAgentDirective(chunk.output)) {
        ctx.emit({
          type: "directive",
          directive: { kind: "switch-agent", payload: chunk.output },
        });
      }
      if (isDashboardNavigateDirective(chunk.output)) {
        ctx.emit({
          type: "directive",
          directive: { kind: "dashboard-navigate", payload: chunk.output },
        });
      }
      if (isPreviewActDirective(chunk.output)) {
        ctx.emit({
          type: "directive",
          directive: { kind: "preview-act", payload: chunk.output },
        });
      }
      if (isRenderedViewDirective(chunk.output)) {
        ctx.emit({
          type: "directive",
          directive: { kind: "rendered-view", payload: chunk.output },
        });
      }
      ctx.emit({
        type: "tool-result",
        id: chunk.toolCallId,
        ...(name !== undefined ? { toolName: name } : {}),
        output: chunk.output,
      });
    } else if (
      chunk.type === "tool-output-error" &&
      chunk.toolCallId !== undefined
    ) {
      // Stream-level tool failure: no output arrived, so no toolName is
      // recorded for the empty-bubble fallback (historical behavior).
      ctx.emit({
        type: "tool-result",
        id: chunk.toolCallId,
        isError: true,
        ...(typeof chunk.errorText === "string"
          ? { errorText: chunk.errorText }
          : {}),
      });
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuf += decoder.decode(value, { stream: true });

    // Process complete SSE events (separated by blank lines).
    let sep: number;
    while ((sep = sseBuf.indexOf("\n\n")) !== -1) {
      const event = sseBuf.slice(0, sep);
      sseBuf = sseBuf.slice(sep + 2);
      if (!event.startsWith("data:")) continue;
      const payload = event.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      const chunk = parseKodyDirectChunk(payload);
      if (!chunk) continue; // skip malformed
      try {
        applyChunk(chunk);
      } catch {
        // Ignore malformed chunks rather than aborting the stream.
      }
    }
  }
}

/**
 * ChatTransport wrapper. The turn config rides in `input.context`
 * (callers build it with `satisfies KodyDirectTurnConfig`).
 */
export const kodyDirectTransport: ChatTransport = {
  id: "kody-direct",
  async send(input, ctx) {
    if (!isKodyDirectTurnConfig(input.context)) {
      throw new Error(
        "kodyDirectTransport.send requires a KodyDirectTurnConfig in input.context",
      );
    }
    await sendKodyDirectTurn(input.context, ctx);
  },
};
