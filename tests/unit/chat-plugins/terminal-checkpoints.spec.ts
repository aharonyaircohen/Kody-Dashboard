/**
 * @fileoverview Behavior coverage for the terminal checkpoint shims moved
 *   out of KodyChat in Step 5a (REWRITE of the checkpoint-wiring half of
 *   terminal-checkpoint-ui.spec.ts — the toolbar-placement pins retired to
 *   the Playwright layers; the /terminal-routes-through-Kody pin lives in
 *   terminal-middleware-order.spec.ts).
 * @testFramework vitest
 * @domain chat-plugins
 */
import { describe, expect, it } from "vitest";

import {
  checkpointTransportFromChatTransport,
  shouldLoadTerminalCheckpoint,
  terminalCheckpointLoadKey,
  terminalCheckpointSearchParams,
} from "@kody-chat/chat/plugins/terminal/checkpoints";

describe("checkpoint transport shims", () => {
  it("maps chat transports onto checkpoint transports", () => {
    expect(
      checkpointTransportFromChatTransport({
        type: "brain",
        label: "Brain terminal",
      }),
    ).toEqual({ type: "brain", label: "Brain terminal" });
    expect(
      checkpointTransportFromChatTransport({
        type: "fly",
        app: "runner-app",
        machineId: "m-1",
        label: "runner",
        feature: "runner",
      }),
    ).toEqual({
      type: "fly",
      app: "runner-app",
      machineId: "m-1",
      label: "runner",
      feature: "runner",
    });
    expect(checkpointTransportFromChatTransport({ type: "local" })).toEqual({
      type: "local",
      label: undefined,
    });
  });

  it("builds the checkpoint query with session, transport, and actor", () => {
    const query = terminalCheckpointSearchParams(
      "octocat",
      { type: "brain", label: "Brain terminal" },
      "chat-1",
    );
    const params = new URLSearchParams(query.slice(1));
    expect(params.get("chatSessionId")).toBe("chat-1");
    expect(JSON.parse(params.get("transport") ?? "{}")).toEqual({
      type: "brain",
      label: "Brain terminal",
    });
    expect(params.get("actorLogin")).toBe("octocat");

    const anonymous = terminalCheckpointSearchParams(
      null,
      { type: "local" },
      "chat-1",
    );
    expect(anonymous).not.toContain("actorLogin");
  });
});

describe("checkpoint load decision", () => {
  const key = terminalCheckpointLoadKey({
    actorLogin: "octocat",
    activeSessionId: "chat-1",
    activeTargetValue: "local",
  });

  it("never replays a checkpoint over a live terminal session", () => {
    expect(
      shouldLoadTerminalCheckpoint({
        chatMode: "terminal",
        activeSessionId: "chat-1",
        hasLiveTerminal: true,
        loadedKey: null,
        nextKey: key,
      }),
    ).toBe(false);
  });

  it("loads only in terminal mode with an active session, once per key", () => {
    expect(
      shouldLoadTerminalCheckpoint({
        chatMode: "terminal",
        activeSessionId: "chat-1",
        hasLiveTerminal: false,
        loadedKey: null,
        nextKey: key,
      }),
    ).toBe(true);
    expect(
      shouldLoadTerminalCheckpoint({
        chatMode: "ai",
        activeSessionId: "chat-1",
        hasLiveTerminal: false,
        loadedKey: null,
        nextKey: key,
      }),
    ).toBe(false);
    expect(
      shouldLoadTerminalCheckpoint({
        chatMode: "terminal",
        activeSessionId: null,
        hasLiveTerminal: false,
        loadedKey: null,
        nextKey: key,
      }),
    ).toBe(false);
    // Same key already loaded → no duplicate fetch.
    expect(
      shouldLoadTerminalCheckpoint({
        chatMode: "terminal",
        activeSessionId: "chat-1",
        hasLiveTerminal: false,
        loadedKey: key,
        nextKey: key,
      }),
    ).toBe(false);
    // Target switch produces a new key → a fresh load is allowed.
    const otherKey = terminalCheckpointLoadKey({
      actorLogin: "octocat",
      activeSessionId: "chat-1",
      activeTargetValue: "brain",
    });
    expect(otherKey).not.toBe(key);
    expect(
      shouldLoadTerminalCheckpoint({
        chatMode: "terminal",
        activeSessionId: "chat-1",
        hasLiveTerminal: false,
        loadedKey: key,
        nextKey: otherKey,
      }),
    ).toBe(true);
  });
});
