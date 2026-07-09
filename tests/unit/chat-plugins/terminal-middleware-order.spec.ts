/**
 * @fileoverview Pinned send-middleware precedence for the terminal plugin
 *   (plan H2 / Step 5a): the terminal-intent middleware runs at order 100 —
 *   it transforms (or a consuming order-100 middleware stops the chain)
 *   BEFORE any order-200 middleware (slash expansion takes 200 in Step 5b).
 * @testFramework vitest
 * @domain chat-plugins
 */
import { describe, expect, it } from "vitest";

import {
  FULL_GRANT,
  createChatPluginRegistry,
  type ChatHostEffect,
  type ChatPlugin,
} from "@dashboard/lib/chat/platform";
import {
  TERMINAL_INTENT_EFFECT,
  TERMINAL_INTENT_MIDDLEWARE_ID,
  readTerminalIntentEffect,
  terminalChatPlugin,
} from "@dashboard/lib/chat/plugins/terminal";
import { buildKodyTerminalPrompt } from "@dashboard/lib/terminal/kody-terminal-directive";

function fixture200(seen: string[]): ChatPlugin {
  return {
    id: "fixture-200",
    capabilities: ["middleware"],
    middleware: [
      {
        id: "fixture-200-middleware",
        order: 200,
        onSend(text) {
          seen.push(text);
          return null;
        },
      },
    ],
  };
}

describe("terminal middleware order (pinned precedence)", () => {
  it("registers the terminal middleware at order 100, ahead of any order-200 middleware", () => {
    const registry = createChatPluginRegistry();
    // Register the 200 plugin FIRST — ordering must come from `order`,
    // not registration sequence.
    registry.register(fixture200([]), FULL_GRANT);
    registry.register(terminalChatPlugin, FULL_GRANT);

    const ids = registry.middleware().map((m) => m.id);
    expect(ids).toEqual([
      TERMINAL_INTENT_MIDDLEWARE_ID,
      "fixture-200-middleware",
    ]);
  });

  it("transforms /terminal input BEFORE an order-200 middleware sees it", () => {
    const registry = createChatPluginRegistry();
    const seenBy200: string[] = [];
    const effects: ChatHostEffect[] = [];
    registry.register(fixture200(seenBy200), FULL_GRANT);
    registry.register(terminalChatPlugin, FULL_GRANT);

    const outcome = registry.runSendMiddleware("/terminal ls -la", {
      host: {},
      dispatchHostEffect: (effect) => effects.push(effect),
    });

    const expectedPrompt = buildKodyTerminalPrompt("ls -la");
    // The 200 middleware received the ALREADY-TRANSFORMED Kody prompt —
    // /terminal routes through Kody first, before slash-level handling.
    expect(seenBy200).toEqual([expectedPrompt]);
    expect(outcome.text).toBe(expectedPrompt);
    expect(outcome.consumedBy).toBeUndefined();

    // The synchronous host effect carries the raw text for the user bubble.
    expect(effects).toHaveLength(1);
    const payload = readTerminalIntentEffect(effects[0]);
    expect(payload).toEqual({
      rawText: "/terminal ls -la",
      intent: "ls -la",
      prompt: expectedPrompt,
    });
  });

  it("passes non-terminal input through untouched and dispatches no effect", () => {
    const registry = createChatPluginRegistry();
    const seenBy200: string[] = [];
    const effects: ChatHostEffect[] = [];
    registry.register(terminalChatPlugin, FULL_GRANT);
    registry.register(fixture200(seenBy200), FULL_GRANT);

    const outcome = registry.runSendMiddleware("plain question", {
      host: {},
      dispatchHostEffect: (effect) => effects.push(effect),
    });

    expect(outcome.text).toBe("plain question");
    expect(seenBy200).toEqual(["plain question"]);
    expect(effects).toHaveLength(0);
  });

  it("a consuming order-100 middleware stops the chain before order 200 runs", () => {
    const registry = createChatPluginRegistry();
    const seenBy200: string[] = [];
    registry.register(fixture200(seenBy200), FULL_GRANT);
    registry.register(
      {
        id: "consuming-100",
        capabilities: ["middleware"],
        middleware: [
          {
            id: "consuming-100-middleware",
            order: 100,
            onSend() {
              return { consumed: true };
            },
          },
        ],
      },
      FULL_GRANT,
    );

    const outcome = registry.runSendMiddleware("anything", {
      host: {},
      dispatchHostEffect: () => {},
    });

    expect(outcome.consumedBy).toBe("consuming-100-middleware");
    expect(seenBy200).toEqual([]);
  });

  it("ignores foreign or malformed effects when reading the terminal-intent payload", () => {
    expect(readTerminalIntentEffect({ kind: "other:effect" })).toBeNull();
    expect(
      readTerminalIntentEffect({
        kind: TERMINAL_INTENT_EFFECT,
        payload: { rawText: "/terminal x" },
      }),
    ).toBeNull();
  });
});
