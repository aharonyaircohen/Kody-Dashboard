/**
 * @fileoverview Kody-live transport adapter specs — the deliberately thin
 * dispatch mechanics: append (queue a turn onto a live runner session) and
 * trigger (GH Actions workflow dispatch). Fire-and-ack: success emits only
 * a waiting-runner status; rejection throws the route's error message,
 * preserving the historical append/trigger error-parsing asymmetry.
 * @testFramework vitest
 * @domain chat-core
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  sendKodyLiveTurn,
  kodyLiveTransport,
  KODY_LIVE_APPEND_ENDPOINT,
  KODY_LIVE_TRIGGER_ENDPOINT,
  type KodyLiveTurnConfig,
} from "@dashboard/lib/chat/core/transports/kody-live";
import {
  jsonResponse,
  installScriptedFetch,
  eventSink,
} from "./stream-helpers";

const APPEND: KodyLiveTurnConfig = {
  kind: "append",
  body: { taskId: "chat-1", content: "hello runner", timestamp: "t0" },
};

const TRIGGER: KodyLiveTurnConfig = {
  kind: "trigger",
  body: { taskId: "task-5", messages: [{ role: "user", content: "go" }] },
};

let restoreFetch: (() => void) | null = null;
afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
});

describe("sendKodyLiveTurn — append", () => {
  it("POSTs the body with the session-scoped auth headers and emits waiting-runner", async () => {
    const { calls, restore } = installScriptedFetch([
      () => jsonResponse({ ok: true }),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyLiveTurn(APPEND, {
      authHeaders: { "x-kody-session": "chat-1" },
      emit: sink.emit,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(KODY_LIVE_APPEND_ENDPOINT);
    expect(calls[0].body).toEqual(APPEND.body);
    expect(calls[0].init?.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-kody-session": "chat-1",
    });
    expect(sink.events).toEqual([{ type: "status", status: "waiting-runner" }]);
  });

  it("throws the route error on rejection", async () => {
    const { restore } = installScriptedFetch([
      () => jsonResponse({ error: "session ended" }, 409),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await expect(
      sendKodyLiveTurn(APPEND, { authHeaders: {}, emit: sink.emit }),
    ).rejects.toThrow("session ended");
    expect(sink.events).toEqual([]);
  });

  it("falls back to HTTP <status> when the error body is not JSON", async () => {
    const { restore } = installScriptedFetch([
      () => new Response("<html>bad gateway</html>", { status: 502 }),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await expect(
      sendKodyLiveTurn(APPEND, { authHeaders: {}, emit: sink.emit }),
    ).rejects.toThrow("HTTP 502");
  });
});

describe("sendKodyLiveTurn — trigger", () => {
  it("POSTs the workflow dispatch body and emits waiting-runner", async () => {
    const { calls, restore } = installScriptedFetch([
      () => jsonResponse({ dispatched: true }),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await sendKodyLiveTurn(TRIGGER, {
      authHeaders: { "x-kody-token": "t" },
      emit: sink.emit,
    });

    expect(calls[0].url).toBe(KODY_LIVE_TRIGGER_ENDPOINT);
    expect(calls[0].body).toEqual(TRIGGER.body);
    expect(sink.events).toEqual([{ type: "status", status: "waiting-runner" }]);
  });

  it("throws the route error on rejection", async () => {
    const { restore } = installScriptedFetch([
      () => jsonResponse({ error: "workflow missing" }, 422),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await expect(
      sendKodyLiveTurn(TRIGGER, { authHeaders: {}, emit: sink.emit }),
    ).rejects.toThrow("workflow missing");
  });

  it("preserves the historical asymmetry: a non-JSON trigger error body throws its parse error", async () => {
    const { restore } = installScriptedFetch([
      () => new Response("plain text failure", { status: 500 }),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    // The pre-adapter code called `await triggerRes.json()` unguarded —
    // a malformed error body surfaced as the JSON parse error, not
    // `HTTP 500`. The adapter keeps that behavior.
    await expect(
      sendKodyLiveTurn(TRIGGER, { authHeaders: {}, emit: sink.emit }),
    ).rejects.toThrow(/JSON/i);
  });
});

describe("kodyLiveTransport (ChatTransport wrapper)", () => {
  it("rejects when input.context is not a KodyLiveTurnConfig", async () => {
    const sink = eventSink();
    await expect(
      kodyLiveTransport.send(
        { sessionId: "s", text: "hi", agentId: "kody-live" },
        { authHeaders: {}, emit: sink.emit },
      ),
    ).rejects.toThrow(/KodyLiveTurnConfig/);
  });

  it("delegates to sendKodyLiveTurn with the config from input.context", async () => {
    const { calls, restore } = installScriptedFetch([
      () => jsonResponse({ ok: true }),
    ]);
    restoreFetch = restore;
    const sink = eventSink();

    await kodyLiveTransport.send(
      {
        sessionId: "s",
        text: "hi",
        agentId: "kody-live",
        context: APPEND as unknown as Record<string, unknown>,
      },
      { authHeaders: {}, emit: sink.emit },
    );

    expect(calls[0].url).toBe(KODY_LIVE_APPEND_ENDPOINT);
  });
});
