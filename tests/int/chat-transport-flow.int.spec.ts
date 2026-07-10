/**
 * @fileoverview Transport flow integration — send→stream→persist. Drives
 * the REAL kody-direct and brain adapters against stubbed fetch streams,
 * feeds their ChatEvents through the REAL event-mapping layer
 * (createTransportTurnHandler) into an in-memory message store wired the
 * same way KodyChat wires its session store, and asserts the final
 * message-list shape (content composition, tool chips, pending
 * directives, error bubbles).
 * @testFramework vitest
 * @domain int
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { sendKodyDirectTurn } from "@kody-ade/kody-chat/core/transports/kody-direct";
import { sendBrainTurn } from "@kody-ade/kody-chat/core/transports/brain";
import {
  createTransportTurnHandler,
  type TransportTurnHandler,
} from "@kody-chat/components/kody-chat-transport-events";
import type { Message } from "@kody-chat/components/kody-chat-types";

/** In-memory stand-in for KodyChat's session-scoped message store. */
function messageStore(seed: Message[]) {
  const store = { messages: seed };
  return {
    store,
    setMessages: (updater: (prev: Message[]) => Message[]) => {
      store.messages = updater(store.messages);
    },
  };
}

/** The two bubbles sendText pushes before any transport work starts. */
function seedTurn(userText: string): Message[] {
  return [
    { role: "user", content: userText, timestamp: "t0" },
    { role: "assistant", content: "", isLoading: true, timestamp: "t1" },
  ];
}

function sseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(enc.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function installFetch(responses: Response[]): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("scripted fetch exhausted");
    return next;
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function makeHandler(
  setMessages: (updater: (prev: Message[]) => Message[]) => void,
): { handler: TransportTurnHandler; loading: { value: boolean | null } } {
  const loading: { value: boolean | null } = { value: null };
  const handler = createTransportTurnHandler({
    setMessages,
    setLoading: (v) => {
      loading.value = v;
    },
    emitVoiceDelta: null,
    voiceMode: false,
  });
  return { handler, loading };
}

let restoreFetch: (() => void) | null = null;
afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
});

describe("kody-direct send→stream→persist", () => {
  it("streams reasoning + text + a tool call into the final assistant message", async () => {
    const d = (p: Record<string, unknown>) => `data: ${JSON.stringify(p)}\n\n`;
    restoreFetch = installFetch([
      sseResponse([
        d({ type: "reasoning-delta", delta: "plan the reply" }),
        d({
          type: "data-tools-index",
          data: { github_get_issue: "Read one issue" },
        }),
        d({
          type: "tool-input-available",
          toolCallId: "c1",
          toolName: "github_get_issue",
          input: { number: 7 },
        }),
        d({
          type: "tool-output-available",
          toolCallId: "c1",
          output: { number: 7, title: "Bug" },
        }),
        d({ type: "text-delta", delta: "Issue #7 " }),
        d({ type: "text-delta", delta: "is a bug report." }),
      ]),
    ]);

    const { store, setMessages } = messageStore(seedTurn("what is issue 7?"));
    const { handler } = makeHandler(setMessages);

    await sendKodyDirectTurn(
      { endpoint: "/api/kody/chat/kody", body: { messages: [] } },
      { authHeaders: {}, emit: handler.handleEvent },
    );

    // The surface-side settle (what sendText does after send() resolves).
    setMessages((prev) =>
      prev.map((m) => (m.isLoading ? { ...m, isLoading: false } : m)),
    );

    expect(store.messages).toHaveLength(2);
    const assistant = store.messages[1];
    expect(assistant.role).toBe("assistant");
    expect(assistant.isLoading).toBe(false);
    // Reasoning wrapped for the collapsed panel + the streamed answer.
    expect(assistant.content).toBe(
      "<think>plan the reply</think>\n\nIssue #7 is a bug report.",
    );
    expect(assistant.toolCalls).toEqual([
      {
        id: "c1",
        name: "github_get_issue",
        arguments: { number: 7 },
        status: "success",
        description: "Read one issue",
      },
    ]);
    // No directives, no errors, no created issue.
    expect(handler.state.pendingSwitchAgent).toBeNull();
    expect(handler.state.pendingCreatedIssue).toBeNull();
    expect(handler.state.lastToolErrorText).toBeNull();
  });

  it("collects deferred directives and captures created issues without touching the bubble", async () => {
    const d = (p: Record<string, unknown>) => `data: ${JSON.stringify(p)}\n\n`;
    const switchAgent = {
      action: "switch_agent",
      agentId: "kody-live",
      agentName: "Kody Live",
      reason: "hand off",
      autoKickoff: "start working",
    };
    restoreFetch = installFetch([
      sseResponse([
        d({
          type: "tool-input-available",
          toolCallId: "c1",
          toolName: "create_feature",
          input: { title: "Add X" },
        }),
        d({
          type: "tool-output-available",
          toolCallId: "c1",
          output: { number: 42, url: "https://github.com/o/r/issues/42" },
        }),
        d({
          type: "tool-input-available",
          toolCallId: "c2",
          toolName: "switch_agent",
          input: {},
        }),
        d({
          type: "tool-output-available",
          toolCallId: "c2",
          output: switchAgent,
        }),
        d({ type: "text-delta", delta: "Created #42, handing off." }),
      ]),
    ]);

    const { store, setMessages } = messageStore(seedTurn("build feature X"));
    const { handler } = makeHandler(setMessages);

    await sendKodyDirectTurn(
      { endpoint: "/api/kody/chat/kody", body: { messages: [] } },
      { authHeaders: {}, emit: handler.handleEvent },
    );

    // Directives are pending state for the post-stream code — not UI.
    expect(handler.state.pendingSwitchAgent).toEqual(switchAgent);
    expect(handler.state.pendingCreatedIssue).toBe(42);
    const assistant = store.messages[1];
    expect(assistant.content).toBe("Created #42, handing off.");
    expect(assistant.toolCalls?.map((tc) => tc.status)).toEqual([
      "success",
      "success",
    ]);
  });

  it("tracks the last tool error so the surface can surface it on an empty bubble", async () => {
    const d = (p: Record<string, unknown>) => `data: ${JSON.stringify(p)}\n\n`;
    restoreFetch = installFetch([
      sseResponse([
        d({
          type: "tool-input-available",
          toolCallId: "c1",
          toolName: "show_view",
          input: {},
        }),
        d({ type: "text-delta", delta: "partial invoke text" }),
        d({
          type: "tool-output-available",
          toolCallId: "c1",
          output: { error: "renderer failed" },
        }),
      ]),
    ]);

    const { store, setMessages } = messageStore(seedTurn("render it"));
    const { handler } = makeHandler(setMessages);

    await sendKodyDirectTurn(
      { endpoint: "/api/kody/chat/kody", body: { messages: [] } },
      { authHeaders: {}, emit: handler.handleEvent },
    );

    expect(handler.state.lastToolErrorText).toBe("renderer failed");
    expect(handler.state.lastToolErrorToolName).toBe("show_view");
    // show_view errors clear the streamed text (the invoke markup must
    // not leak into the visible chat) and flip the chip to error.
    expect(handler.state.textBuf).toBe("");
    const assistant = store.messages[1];
    expect(assistant.content).toBe("");
    expect(assistant.toolCalls?.[0].status).toBe("error");
  });
});

describe("brain send→stream→persist", () => {
  it("replays full snapshots into the bubble and settles on chat.done", async () => {
    const l = (p: Record<string, unknown>) => `data: ${JSON.stringify(p)}\n`;
    restoreFetch = installFetch([
      sseResponse([
        l({ type: "chat.message", role: "assistant", content: "Hi", seq: 1 }),
        l({
          type: "chat.tool_use",
          name: "repo_read",
          input: { path: "README.md" },
          seq: 2,
        }),
        l({
          type: "chat.message",
          role: "assistant",
          content: "Hi — read the README.",
          seq: 3,
        }),
        l({ type: "chat.done", seq: 4 }),
      ]),
    ]);

    const { store, setMessages } = messageStore(seedTurn("hello brain"));
    const { handler, loading } = makeHandler(setMessages);

    await sendBrainTurn(
      {
        endpoint: "/api/kody/chat/brain",
        chatId: "k--global--s1",
        initialBody: { chatId: "k--global--s1", message: "hello brain" },
      },
      { authHeaders: {}, emit: handler.handleEvent },
    );

    expect(loading.value).toBe(false); // chat.done cleared the typing state
    const assistant = store.messages[1];
    expect(assistant.isLoading).toBe(false);
    expect(assistant.content).toBe("Hi — read the README.");
    // Brain chips land as completed calls, id-less.
    expect(assistant.toolCalls).toEqual([
      {
        name: "repo_read",
        arguments: { path: "README.md" },
        status: "success",
      },
    ]);
    expect(handler.state.latestAssistantText).toBe("Hi — read the README.");
    expect(handler.state.exhausted).toBe(false);
  });

  it("replaces the in-flight bubble with an error bubble on chat.error", async () => {
    const l = (p: Record<string, unknown>) => `data: ${JSON.stringify(p)}\n`;
    restoreFetch = installFetch([
      sseResponse([l({ type: "chat.error", error: "worktree clone failed" })]),
    ]);

    const { store, setMessages } = messageStore(seedTurn("hello brain"));
    const { handler } = makeHandler(setMessages);

    await sendBrainTurn(
      {
        endpoint: "/api/kody/chat/brain",
        chatId: "k--global--s1",
        initialBody: { chatId: "k--global--s1", message: "hello brain" },
      },
      { authHeaders: {}, emit: handler.handleEvent },
    );

    expect(store.messages).toHaveLength(2);
    const last = store.messages[1];
    expect(last).toEqual({
      role: "assistant",
      content: "Error: worktree clone failed",
      isLoading: false,
      isError: true,
    });
    expect(handler.state.exhausted).toBe(false);
  });
});
