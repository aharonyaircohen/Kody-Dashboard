/**
 * @fileType module
 * @domain chat-platform
 * @pattern chat-transport-adapter
 * @ai-summary Brain ChatTransport adapter (plan H1, Step 2c). Lifecycle
 *   model: server-stateful sync SSE against a pinned chat id. The Brain
 *   reply runs to completion server-side; the Vercel proxy is hard-killed
 *   at ~300s, so one turn can arrive across several proxy connections —
 *   the adapter owns the resume loop (re-attach with `resumeSince`), the
 *   cold-start retry gate (suspended Fly machines answer 500/503/504
 *   while booting), and the SSE parse. It emits ChatEvents; the surface
 *   owns bubbles, abort controllers, and the returned spoken text.
 */

import { parseBrainWireEvent } from "./envelope";
import type { ChatTransport, ChatTransportContext } from "./transport-types";

/** `error` ChatEvent codes this adapter emits. */
export const BRAIN_ERROR_CODE_TURN = "brain-turn-error";
export const BRAIN_ERROR_CODE_EXHAUSTED = "brain-exhausted";

export const BRAIN_EXHAUSTED_MESSAGE =
  "lost the connection to Brain and couldn't resume the reply after several attempts. The work may still be running — try again in a moment.";

/** Bounded so a pathologically stuck turn can't loop forever. */
const DEFAULT_MAX_RECONNECTS = 60;
/**
 * Cold-start gate. The first turn against a suspended/new Brain machine
 * must wait for Fly to boot it (~100s) plus the per-chat repo clone. The
 * proxy waits server-side (waitForBrainHealth), but a cold boot can still
 * hand back a 504 (health not ready in one request), a 503 (transient Fly
 * provisioning), or a 500 (function timeout) before the machine answers.
 * Rather than surface that as a chat error, hold the message and retry on
 * these transient statuses — both before the turn starts (resend the
 * message) and after (resume from lastSeq, which is idempotent), so a
 * hiccup on a mid-turn reconnect doesn't fail an otherwise-running reply.
 * 502 is deliberately excluded for hard misconfigurations that must
 * surface now, not after retries.
 */
const DEFAULT_MAX_COLD_START_RETRIES = 10;
const DEFAULT_COLD_START_RETRY_MS = 3000;
const COLD_START_STATUSES = new Set([500, 503, 504]);

export interface BrainTurnConfig {
  /** `/api/kody/chat/brain` or `/api/kody/chat/brain-fly`. */
  endpoint: string;
  /** Pinned Brain chat id — rides both the first POST and every resume. */
  chatId: string;
  /**
   * First-POST body (chatId, message, currentPage, includeContext,
   * taskContext, capabilityContext, attachments, voiceMode,
   * reasoningEffort). Assembled by the surface — it owns that state.
   */
  initialBody: Readonly<Record<string, unknown>>;
  /** Test seams. Production callers leave these unset. */
  maxReconnects?: number;
  maxColdStartRetries?: number;
  coldStartRetryMs?: number;
}

function isBrainTurnConfig(value: unknown): value is BrainTurnConfig {
  if (!value || typeof value !== "object") return false;
  const cfg = value as Partial<BrainTurnConfig>;
  return (
    typeof cfg.endpoint === "string" &&
    typeof cfg.chatId === "string" &&
    !!cfg.initialBody &&
    typeof cfg.initialBody === "object"
  );
}

type TurnOutcome = "done" | "error" | "aborted" | "exhausted";

/**
 * Run one Brain turn: POST the message, stream SSE, re-attach across
 * proxy hand-backs until a terminal event. Emits ChatEvents via ctx.emit.
 * Hard HTTP failures and AbortErrors THROW (the surface owns its
 * historical catch semantics); `chat.error` and reconnect exhaustion are
 * emitted as non-recoverable `error` events instead.
 */
export async function sendBrainTurn(
  config: BrainTurnConfig,
  ctx: ChatTransportContext,
): Promise<void> {
  const maxReconnects = config.maxReconnects ?? DEFAULT_MAX_RECONNECTS;
  const maxColdStartRetries =
    config.maxColdStartRetries ?? DEFAULT_MAX_COLD_START_RETRIES;
  const coldStartRetryMs =
    config.coldStartRetryMs ?? DEFAULT_COLD_START_RETRY_MS;

  let coldStartRetries = 0;
  // Until the Brain has accepted the message and started a turn, a retry
  // must RESEND the message; once it has, a retry RESUMES from lastSeq.
  let messageDelivered = false;
  let latestAssistantText = "";
  let lastSeq = 0;
  // Held on an object so TS doesn't narrow it to the initializer — the
  // value is mutated inside the applyEvent closure below.
  const turn: { outcome: TurnOutcome } = { outcome: "exhausted" };

  for (let attempt = 0; attempt <= maxReconnects; attempt++) {
    const isReconnect = messageDelivered;
    const res = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...ctx.authHeaders,
      },
      body: JSON.stringify(
        isReconnect
          ? {
              chatId: config.chatId,
              resumeSince: lastSeq,
              resumeText: latestAssistantText,
            }
          : config.initialBody,
      ),
      signal: ctx.signal,
    });
    if (!res.ok || !res.body) {
      // Wait and retry rather than failing the message — for statuses
      // that signal "not ready / transient" (a cold boot or a function
      // timeout), not a hard misconfig like 400/401. This covers BOTH
      // phases: before the turn starts the loop resends the message;
      // after it starts (messageDelivered) the loop re-attaches with
      // resumeSince, which is idempotent. The retry budget bounds it so
      // a genuinely broken turn still surfaces.
      if (
        ctx.signal?.aborted !== true &&
        COLD_START_STATUSES.has(res.status) &&
        coldStartRetries < maxColdStartRetries
      ) {
        coldStartRetries++;
        await res.body?.cancel().catch(() => {});
        await new Promise((r) => setTimeout(r, coldStartRetryMs));
        continue;
      }
      const errorData = (await res
        .json()
        .catch(() => ({ error: `HTTP ${res.status}` }))) as {
        error?: string;
      };
      throw new Error(errorData.error || `HTTP ${res.status}`);
    }
    // Message accepted; the Brain turn is running. Further loop
    // iterations re-attach (resume) instead of resending.
    messageDelivered = true;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    // Per-connection: did the proxy ask us to reconnect, and did the
    // turn reach a terminal event on this connection?
    let reconnectRequested = false;

    const applyEvent = (parsed: {
      type?: string;
      role?: string;
      content?: string;
      timestamp?: string;
      error?: string;
      name?: string;
      input?: Record<string, unknown>;
      seq?: number;
    }) => {
      if (typeof parsed.seq === "number" && parsed.seq > lastSeq) {
        lastSeq = parsed.seq;
      }
      if (parsed.type === "chat.reconnect") {
        // Proxy handed the turn back before the Vercel ceiling (or the
        // upstream connection dropped). Reconnect from `lastSeq`.
        reconnectRequested = true;
        return;
      }
      if (parsed.type === "chat.message") {
        if (parsed.role !== "user" && typeof parsed.content === "string") {
          latestAssistantText = parsed.content;
        }
        ctx.emit({
          type: "message",
          role: parsed.role === "user" ? "user" : "assistant",
          ...(typeof parsed.content === "string"
            ? { content: parsed.content }
            : {}),
          ...(parsed.timestamp ? { timestamp: parsed.timestamp } : {}),
        });
      } else if (parsed.type === "chat.tool_use") {
        // Brain reports tool calls after the fact — the chip lands as a
        // completed (`success`) call, id-less, exactly as before.
        ctx.emit({
          type: "tool-call",
          toolName: parsed.name ?? "tool",
          input: parsed.input ?? {},
          status: "success",
          ...(parsed.timestamp ? { timestamp: parsed.timestamp } : {}),
        });
      } else if (parsed.type === "chat.done") {
        turn.outcome = "done";
        ctx.emit({ type: "done" });
      } else if (parsed.type === "chat.error") {
        turn.outcome = "error";
        ctx.emit({
          type: "error",
          message: parsed.error ?? "Unknown error",
          recoverable: false,
          code: BRAIN_ERROR_CODE_TURN,
        });
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lastNewline = buf.lastIndexOf("\n");
      if (lastNewline === -1) continue;
      const chunk = buf.slice(0, lastNewline + 1);
      buf = buf.slice(lastNewline + 1);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        const parsed = parseBrainWireEvent(raw);
        if (!parsed) continue; // skip malformed
        try {
          applyEvent(parsed);
        } catch {
          // A single bad event must not kill the stream (historical
          // behavior: the whole applyEvent ran inside a swallow-all).
        }
      }
    }
    await reader.cancel().catch(() => {});

    // The turn finished on this connection — stop reconnecting.
    if (turn.outcome === "done" || turn.outcome === "error") break;
    if (ctx.signal?.aborted === true) {
      turn.outcome = "aborted";
      break;
    }
    // Connection ended without a terminal event: either the proxy handed
    // back before the Vercel ceiling (`chat.reconnect`) or the upstream
    // dropped. Either way the turn keeps running on Brain — loop to
    // re-attach from `lastSeq`. `reconnectRequested` is read here only to
    // document intent; we reconnect regardless.
    void reconnectRequested;
  }

  if (turn.outcome === "exhausted") {
    ctx.emit({
      type: "error",
      message: BRAIN_EXHAUSTED_MESSAGE,
      recoverable: false,
      code: BRAIN_ERROR_CODE_EXHAUSTED,
    });
  }
}

/**
 * ChatTransport wrapper. The turn config rides in `input.context`
 * (callers build it with `satisfies BrainTurnConfig`).
 */
export const brainTransport: ChatTransport = {
  id: "brain",
  async send(input, ctx) {
    if (!isBrainTurnConfig(input.context)) {
      throw new Error(
        "brainTransport.send requires a BrainTurnConfig in input.context",
      );
    }
    await sendBrainTurn(input.context, ctx);
  },
};
