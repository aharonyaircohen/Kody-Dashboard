/**
 * @fileoverview Unit tests for the chat plugin registry: registration
 * validation, deterministic middleware ordering, slot collection, theme
 * merge, display-mode arbitration, host effects.
 *
 * @testFramework vitest
 * @domain chat-platform
 */
import { describe, expect, it, vi } from "vitest";

import {
  ChatPluginRegistrationError,
  createChatPluginRegistry,
} from "@dashboard/lib/chat/platform/registry";
import { FULL_GRANT } from "@dashboard/lib/chat/platform/capabilities";
import type {
  ChatPlugin,
  ChatSendMiddlewareContext,
} from "@dashboard/lib/chat/platform/types";

const noopCtx: ChatSendMiddlewareContext = {
  host: {},
  dispatchHostEffect: () => {},
};

const middlewarePlugin = (
  id: string,
  order: number,
  onSend: ChatPlugin["middleware"] extends readonly (infer M)[] | undefined
    ? M extends { onSend: infer F }
      ? F
      : never
    : never,
): ChatPlugin => ({
  id,
  capabilities: ["middleware"],
  middleware: [{ id: `${id}-mw`, order, onSend }],
});

describe("chat plugin registry", () => {
  it("rejects duplicate plugin ids", () => {
    const registry = createChatPluginRegistry();
    const plugin: ChatPlugin = { id: "p", capabilities: [] };
    registry.register(plugin, FULL_GRANT);
    expect(() => registry.register(plugin, FULL_GRANT)).toThrow(
      ChatPluginRegistrationError,
    );
  });

  it("rejects contributions without the declared capability", () => {
    const registry = createChatPluginRegistry();
    const plugin: ChatPlugin = {
      id: "sneaky",
      capabilities: [], // declares nothing…
      middleware: [{ id: "m", order: 1, onSend: () => null }], // …contributes anyway
    };
    expect(() => registry.register(plugin, FULL_GRANT)).toThrow(
      /without declaring capability "middleware"/,
    );
  });

  it("rejects declared capabilities outside the surface grant", () => {
    const registry = createChatPluginRegistry();
    const plugin: ChatPlugin = { id: "terminal", capabilities: ["display-modes"] };
    expect(() => registry.register(plugin, ["theme"])).toThrow(
      /"display-modes" is not granted/,
    );
  });

  it("orders middleware by order asc, ties broken by plugin id", () => {
    const registry = createChatPluginRegistry();
    const calls: string[] = [];
    registry.register(
      middlewarePlugin("b-late", 200, () => {
        calls.push("b-late");
        return null;
      }),
      FULL_GRANT,
    );
    registry.register(
      middlewarePlugin("z-early", 100, () => {
        calls.push("z-early");
        return null;
      }),
      FULL_GRANT,
    );
    registry.register(
      middlewarePlugin("a-late", 200, () => {
        calls.push("a-late");
        return null;
      }),
      FULL_GRANT,
    );
    registry.runSendMiddleware("hello", noopCtx);
    expect(calls).toEqual(["z-early", "a-late", "b-late"]);
  });

  it("middleware can transform text and consume the message", () => {
    const registry = createChatPluginRegistry();
    registry.register(
      middlewarePlugin("expander", 100, (text: string) => ({
        text: text.toUpperCase(),
      })),
      FULL_GRANT,
    );
    const after = vi.fn(() => null);
    registry.register(
      middlewarePlugin("consumer", 200, () => ({ consumed: true })),
      FULL_GRANT,
    );
    registry.register(middlewarePlugin("never", 300, after), FULL_GRANT);

    const outcome = registry.runSendMiddleware("hi", noopCtx);
    expect(outcome).toEqual({ text: "HI", consumedBy: "consumer-mw" });
    expect(after).not.toHaveBeenCalled();
  });

  it("merges theme with later registration winning per field", () => {
    const registry = createChatPluginRegistry();
    registry.register(
      {
        id: "base",
        capabilities: ["theme"],
        theme: { name: "Kody", accent: "#111111" },
      },
      FULL_GRANT,
    );
    registry.register(
      { id: "brand", capabilities: ["theme"], theme: { accent: "#0f766e" } },
      FULL_GRANT,
    );
    expect(registry.theme()).toEqual({ name: "Kody", accent: "#0f766e" });
  });

  it("arbitrates display modes: forced wins, else highest priority, else ai", () => {
    const registry = createChatPluginRegistry();
    registry.register(
      {
        id: "terminal",
        capabilities: ["display-modes"],
        displayModes: [{ id: "terminal", priority: 10 }],
      },
      FULL_GRANT,
    );
    expect(registry.resolveDisplayMode(["terminal"])).toBe("terminal");
    // Host force (vibe) suppresses terminal without any plugin coupling.
    expect(registry.resolveDisplayMode(["terminal"], "ai")).toBe("ai");
    expect(registry.resolveDisplayMode([])).toBe("ai");
  });

  it("namespaces plugin messages and collects agents", () => {
    const registry = createChatPluginRegistry();
    registry.register(
      {
        id: "branding",
        capabilities: ["theme", "agents"],
        theme: {},
        agents: ["client-support"],
        messages: { welcome: "Hello {name}" },
      },
      FULL_GRANT,
    );
    expect(registry.messages()).toEqual({
      "plugin.branding.welcome": "Hello {name}",
    });
    expect(registry.agents()).toEqual(["client-support"]);
  });

  it("delivers host effects to subscribers until unsubscribed", () => {
    const registry = createChatPluginRegistry();
    const seen: string[] = [];
    const off = registry.onHostEffect((effect) => seen.push(effect.kind));
    registry.dispatchHostEffect({ kind: "scope-change" });
    off();
    registry.dispatchHostEffect({ kind: "ignored" });
    expect(seen).toEqual(["scope-change"]);
  });
});
