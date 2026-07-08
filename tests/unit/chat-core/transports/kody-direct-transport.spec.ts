/**
 * @fileoverview Kody-direct transport adapter specs — drives
 * sendKodyDirectTurn with scripted AI SDK SSE streams and asserts the
 * emitted ChatEvent sequences: token/reasoning deltas, the tool-call
 * path (chips, descriptions, results), final_answer replacement,
 * directive detection, tool errors, inline stream errors, HTTP failure,
 * and abort propagation.
 * @testFramework vitest
 * @domain chat-core
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  sendKodyDirectTurn,
  kodyDirectTransport,
  type KodyDirectTurnConfig,
} from "@dashboard/lib/chat/core/transports/kody-direct";
import {
  sseResponse,
  abortingResponse,
  installScriptedFetch,
  eventSink,
} from "./stream-helpers";

const CONFIG: KodyDirectTurnConfig = {
  endpoint: "/api/kody/chat/kody",
  body: { messages: [{ role: "user", content: "hi" }], agentId: "kody" },
};

function chunk(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

let restoreFetch: (() => void) | null = null;
afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
});

describe("sendKodyDirectTurn", () => {
  it("POSTs the body once and emits token/reasoning deltas in order", async () => {
    const { calls, restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({ type: "reasoning-delta", delta: "thinking " }),
          chunk({ type: "text-delta", delta: "Hello " }),
          "data: {corrupt\n\n", // skipped, stream continues
          chunk({ type: "text-delta", delta: "world" }),
          "data: [DONE]\n\n",
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, {
      authHeaders: { "x-kody-token": "t" },
      emit: sink.emit,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/kody/chat/kody");
    expect(calls[0].body).toEqual(CONFIG.body);
    expect(calls[0].init?.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-kody-token": "t",
    });
    expect(sink.events).toEqual([
      { type: "reasoning", text: "thinking " },
      { type: "token", text: "Hello " },
      { type: "token", text: "world" },
    ]);
    // Deliberately no `done` — the surface settles after send() resolves.
  });

  it("emits a running tool chip with its indexed description, then the success result", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({
            type: "data-tools-index",
            data: { fetch_url: "Fetch a URL", noise: 42 },
          }),
          chunk({
            type: "tool-input-start",
            toolCallId: "call-1",
            toolName: "fetch_url",
          }),
          chunk({
            type: "tool-input-available",
            toolCallId: "call-1",
            toolName: "fetch_url",
            input: { url: "https://x" },
          }),
          chunk({
            type: "tool-output-available",
            toolCallId: "call-1",
            output: { ok: true },
          }),
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      {
        type: "tool-call",
        id: "call-1",
        toolName: "fetch_url",
        input: { url: "https://x" },
        status: "running",
        description: "Fetch a URL",
      },
      {
        type: "tool-result",
        id: "call-1",
        toolName: "fetch_url",
        output: { ok: true },
      },
    ]);
  });

  it("final_answer never becomes a chip; its output replaces the streamed text", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({ type: "text-delta", delta: "draft..." }),
          chunk({
            type: "tool-input-available",
            toolCallId: "fa-1",
            toolName: "final_answer",
            input: { content: "Final." },
          }),
          chunk({
            type: "tool-output-available",
            toolCallId: "fa-1",
            output: { content: "Final." },
          }),
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      { type: "token", text: "draft..." },
      { type: "text-replace", text: "Final." },
    ]);
  });

  it("emits an error tool-result (with the tool name) for `{ error }` outputs — no directives", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({
            type: "tool-input-available",
            toolCallId: "c1",
            toolName: "show_view",
            input: {},
          }),
          chunk({
            type: "tool-output-available",
            toolCallId: "c1",
            output: { error: "renderer exploded" },
          }),
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      {
        type: "tool-call",
        id: "c1",
        toolName: "show_view",
        input: {},
        status: "running",
      },
      {
        type: "tool-result",
        id: "c1",
        toolName: "show_view",
        output: { error: "renderer exploded" },
        isError: true,
        errorText: "renderer exploded",
      },
    ]);
  });

  it("emits an error tool-result WITHOUT a tool name for stream-level tool-output-error", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({
            type: "tool-output-error",
            toolCallId: "c9",
            errorText: "timed out",
          }),
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      { type: "tool-result", id: "c9", isError: true, errorText: "timed out" },
    ]);
  });

  it("detects directives by shape and emits them before the success result", async () => {
    const switchAgent = {
      action: "switch_agent",
      agentId: "kody-live",
      agentName: "Kody Live",
      reason: "execution requested",
      autoKickoff: "go",
    };
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({
            type: "tool-input-available",
            toolCallId: "c2",
            toolName: "switch_agent",
            input: {},
          }),
          chunk({
            type: "tool-output-available",
            toolCallId: "c2",
            output: switchAgent,
          }),
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      {
        type: "tool-call",
        id: "c2",
        toolName: "switch_agent",
        input: {},
        status: "running",
      },
      {
        type: "directive",
        directive: { kind: "switch-agent", payload: switchAgent },
      },
      {
        type: "tool-result",
        id: "c2",
        toolName: "switch_agent",
        output: switchAgent,
      },
    ]);
  });

  it("detects dashboard_navigate and preview_act directives", async () => {
    const navigate = {
      action: "dashboard_navigate",
      routeId: "settings",
      href: "/settings",
      label: "Settings",
      reason: "user asked",
    };
    const act = {
      action: "preview_act",
      op: "click",
      reason: "press the button",
    };
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({
            type: "tool-input-available",
            toolCallId: "n1",
            toolName: "dashboard_navigate",
            input: {},
          }),
          chunk({
            type: "tool-output-available",
            toolCallId: "n1",
            output: navigate,
          }),
          chunk({
            type: "tool-input-available",
            toolCallId: "p1",
            toolName: "preview_act",
            input: {},
          }),
          chunk({
            type: "tool-output-available",
            toolCallId: "p1",
            output: act,
          }),
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    const directives = sink.events.filter((e) => e.type === "directive");
    expect(directives).toEqual([
      {
        type: "directive",
        directive: { kind: "dashboard-navigate", payload: navigate },
      },
      { type: "directive", directive: { kind: "preview-act", payload: act } },
    ]);
  });

  it("emits inline stream errors as RECOVERABLE error events", async () => {
    const { restore } = installScriptedFetch([
      () =>
        sseResponse([
          chunk({ type: "text-delta", delta: "partial" }),
          chunk({ type: "error", errorText: "model overloaded" }),
        ]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit });

    expect(sink.events).toEqual([
      { type: "token", text: "partial" },
      { type: "error", message: "model overloaded", recoverable: true },
    ]);
  });

  it("throws the response text on HTTP failure", async () => {
    const { restore } = installScriptedFetch([
      () => new Response("model not configured", { status: 500 }),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await expect(
      sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit }),
    ).rejects.toThrow("model not configured");
    expect(sink.events).toEqual([]);
  });

  it("propagates AbortError mid-stream (surface owns stop semantics)", async () => {
    const { restore } = installScriptedFetch([
      () => abortingResponse([chunk({ type: "text-delta", delta: "par" })]),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await expect(
      sendKodyDirectTurn(CONFIG, { authHeaders: {}, emit: sink.emit }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(sink.events).toEqual([{ type: "token", text: "par" }]);
  });
});

describe("kodyDirectTransport (ChatTransport wrapper)", () => {
  it("rejects when input.context is not a KodyDirectTurnConfig", async () => {
    const sink = eventSink();
    await expect(
      kodyDirectTransport.send(
        { sessionId: "s", text: "hi", agentId: "kody" },
        { authHeaders: {}, emit: sink.emit },
      ),
    ).rejects.toThrow(/KodyDirectTurnConfig/);
  });
});
