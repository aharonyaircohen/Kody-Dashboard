/**
 * @fileoverview Brain transport adapter specs — drives sendBrainTurn with
 * scripted fetch streams and asserts the emitted ChatEvent sequences:
 * happy path, tool_use, terminal error, reconnect/resume, cold-start
 * retry, exhausted budget, hard HTTP failure, and abort propagation.
 * @testFramework vitest
 * @domain chat-core
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  sendBrainTurn,
  brainTransport,
  BRAIN_ERROR_CODE_EXHAUSTED,
  BRAIN_ERROR_CODE_TURN,
  BRAIN_EXHAUSTED_MESSAGE,
  type BrainTurnConfig,
} from "@dashboard/lib/chat/core/transports/brain";
import {
  sseResponse,
  abortingResponse,
  jsonResponse,
  installScriptedFetch,
  eventSink,
} from "./stream-helpers";

const CONFIG: BrainTurnConfig = {
  endpoint: "/api/kody/chat/brain",
  chatId: "user--repo--global--s1",
  initialBody: {
    chatId: "user--repo--global--s1",
    message: "hi brain",
    includeContext: true,
  },
};

function line(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n`;
}

let restoreFetch: (() => void) | null = null;
afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
});

describe("sendBrainTurn", () => {
  it("streams message snapshots, tool_use, and done as ChatEvents", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          line({
            type: "chat.message",
            role: "assistant",
            content: "Hel",
            seq: 1,
          }),
          line({
            type: "chat.message",
            role: "assistant",
            content: "Hello",
            seq: 2,
          }),
          line({
            type: "chat.tool_use",
            name: "github_search_code",
            input: { q: "x" },
            seq: 3,
          }),
          "data: {corrupt json\n", // skipped, stream continues
          line({ type: "chat.done", seq: 4 }),
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendBrainTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      { type: "message", role: "assistant", content: "Hel" },
      { type: "message", role: "assistant", content: "Hello" },
      {
        type: "tool-call",
        toolName: "github_search_code",
        input: { q: "x" },
        status: "success",
      },
      { type: "done" },
    ]);
  });

  it("sends the initial body on the first POST with merged auth headers", async () => {
    const { calls, restore } = installScriptedFetch([
      () => sseResponse([line({ type: "chat.done", seq: 1 })]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendBrainTurn(CONFIG, {
      authHeaders: { "x-kody-token": "t", "x-brain-url": "u" },
      emit: sink.emit,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/kody/chat/brain");
    expect(calls[0].body).toEqual(CONFIG.initialBody);
    expect(calls[0].init?.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-kody-token": "t",
      "x-brain-url": "u",
    });
  });

  it("re-attaches with resumeSince/resumeText when a connection drops mid-turn", async () => {
    const { calls, restore } = installScriptedFetch([
      // First connection: partial reply, then the proxy hands back.
      () =>
        sseResponse([
          line({
            type: "chat.message",
            role: "assistant",
            content: "part",
            seq: 5,
          }),
          line({ type: "chat.reconnect", seq: 6 }),
        ]),
      // Second connection: replay + finish.
      () =>
        sseResponse([
          line({
            type: "chat.message",
            role: "assistant",
            content: "part+rest",
            seq: 7,
          }),
          line({ type: "chat.done", seq: 8 }),
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendBrainTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(calls).toHaveLength(2);
    // Resume body: chatId + lastSeq + the text shown so far.
    expect(calls[1].body).toEqual({
      chatId: CONFIG.chatId,
      resumeSince: 6,
      resumeText: "part",
    });
    expect(sink.events.at(-1)).toEqual({ type: "done" });
  });

  it("retries transient cold-start statuses by resending the message", async () => {
    const { calls, restore } = installScriptedFetch([
      () => jsonResponse({ error: "cold" }, 503),
      () => sseResponse([line({ type: "chat.done", seq: 1 })]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendBrainTurn(
      { ...CONFIG, coldStartRetryMs: 1 },
      { authHeaders: {}, emit: sink.emit },
    );

    expect(calls).toHaveLength(2);
    // Message was NOT delivered on the 503 — the retry resends it.
    expect(calls[1].body).toEqual(CONFIG.initialBody);
    expect(sink.events).toEqual([{ type: "done" }]);
  });

  it("throws the route error on non-retryable HTTP failures", async () => {
    const { restore } = installScriptedFetch([
      () => jsonResponse({ error: "brain url not configured" }, 400),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await expect(
      sendBrainTurn(CONFIG, { authHeaders: {}, emit: sink.emit }),
    ).rejects.toThrow("brain url not configured");
    expect(sink.events).toEqual([]);
  });

  it("emits a non-recoverable error event on chat.error", async () => {
    const { restore } = installScriptedFetch([
      () => sseResponse([line({ type: "chat.error", error: "boom", seq: 1 })]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendBrainTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      {
        type: "error",
        message: "boom",
        recoverable: false,
        code: BRAIN_ERROR_CODE_TURN,
      },
    ]);
  });

  it("emits the exhausted error when the reconnect budget runs out", async () => {
    const { calls, restore } = installScriptedFetch([
      () => sseResponse([line({ type: "chat.message", content: "a", seq: 1 })]),
      () =>
        sseResponse([line({ type: "chat.message", content: "ab", seq: 2 })]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendBrainTurn(
      { ...CONFIG, maxReconnects: 1 },
      { authHeaders: {}, emit: sink.emit },
    );

    expect(calls).toHaveLength(2);
    expect(sink.events.at(-1)).toEqual({
      type: "error",
      message: BRAIN_EXHAUSTED_MESSAGE,
      recoverable: false,
      code: BRAIN_ERROR_CODE_EXHAUSTED,
    });
  });

  it("propagates AbortError to the caller (surface owns stop semantics)", async () => {
    const { restore } = installScriptedFetch([
      () =>
        abortingResponse([
          line({
            type: "chat.message",
            role: "assistant",
            content: "par",
            seq: 1,
          }),
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await expect(
      sendBrainTurn(CONFIG, { authHeaders: {}, emit: sink.emit }),
    ).rejects.toMatchObject({ name: "AbortError" });
    // The partial snapshot still reached the surface before the abort.
    expect(sink.events).toEqual([
      { type: "message", role: "assistant", content: "par" },
    ]);
  });

  it("stops reconnecting when the signal aborted between connections", async () => {
    const controller = new AbortController();
    const { calls, restore } = installScriptedFetch([
      () => {
        // Stream ends without a terminal event, but the user hit Stop
        // while it was draining — the loop must not re-attach.
        controller.abort();
        return sseResponse([
          line({ type: "chat.message", content: "partial", seq: 1 }),
        ]);
      },
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendBrainTurn(CONFIG, {
      authHeaders: {},
      signal: controller.signal,
      emit: sink.emit,
    });

    expect(calls).toHaveLength(1);
    // No exhausted error — the aborted outcome returns quietly.
    expect(sink.events.some((e) => e.type === "error")).toBe(false);
  });
});

describe("brainTransport (ChatTransport wrapper)", () => {
  it("rejects when input.context is not a BrainTurnConfig", async () => {
    const sink = eventSink();
    await expect(
      brainTransport.send(
        { sessionId: "s", text: "hi", agentId: "brain" },
        { authHeaders: {}, emit: sink.emit },
      ),
    ).rejects.toThrow(/BrainTurnConfig/);
  });

  it("delegates to sendBrainTurn with the config from input.context", async () => {
    const { calls, restore } = installScriptedFetch([
      () => sseResponse([`data: ${JSON.stringify({ type: "chat.done" })}\n`]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await brainTransport.send(
      {
        sessionId: "s",
        text: "hi",
        agentId: "brain",
        context: CONFIG as unknown as Record<string, unknown>,
      },
      { authHeaders: {}, emit: sink.emit },
    );

    expect(calls[0].url).toBe(CONFIG.endpoint);
    expect(sink.events).toEqual([{ type: "done" }]);
  });
});
