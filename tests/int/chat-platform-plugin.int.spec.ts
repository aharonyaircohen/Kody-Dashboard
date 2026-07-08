/**
 * @fileoverview Integration test: a fixture plugin registers across the
 * whole platform surface — client manifest into the registry (slots,
 * middleware, theme, messages → catalog) and its server half into the
 * server tool registry with zod-validated execution.
 *
 * @testFramework vitest
 * @domain chat-platform
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createChatCatalog,
  createChatPluginRegistry,
  createChatServerToolRegistry,
  ChatToolRegistrationError,
  type ChatPlugin,
  type ChatToolServerContext,
} from "@dashboard/lib/chat/platform";

const serverCtx: ChatToolServerContext = {
  owner: "test-owner",
  repo: "test-repo",
  token: "ghp_test",
};

function fixturePlugin(): ChatPlugin {
  return {
    id: "fixture",
    capabilities: ["slots", "middleware", "theme", "tools"],
    slots: [
      {
        slot: "composer-actions",
        id: "fixture-action",
        component: () => null,
      },
    ],
    middleware: [
      {
        id: "fixture-expand",
        order: 200,
        onSend: (text) =>
          text.startsWith("/fix ")
            ? { text: `expanded:${text.slice(5)}` }
            : null,
      },
    ],
    theme: { name: "Fixture Brand", accent: "#123456" },
    messages: { hello: "Hello {who}" },
  };
}

describe("chat platform fixture plugin (int)", () => {
  it("registers the client manifest end-to-end", () => {
    const registry = createChatPluginRegistry();
    const catalog = createChatCatalog();

    registry.register(fixturePlugin(), [
      "slots",
      "middleware",
      "theme",
      "tools",
    ]);
    catalog.register(registry.messages());

    expect(registry.slots("composer-actions")).toHaveLength(1);
    expect(registry.theme().name).toBe("Fixture Brand");
    expect(catalog.t("plugin.fixture.hello", { who: "world" })).toBe(
      "Hello world",
    );

    const outcome = registry.runSendMiddleware("/fix bug", {
      host: {},
      dispatchHostEffect: () => {},
    });
    expect(outcome.text).toBe("expanded:bug");
    expect(outcome.consumedBy).toBeUndefined();
  });

  it("server tools: registration, zod validation, collision detection", async () => {
    const tools = createChatServerToolRegistry();
    tools.register("fixture", () => ({
      fixture_echo: {
        description: "Echo a message",
        inputSchema: z.object({ message: z.string().min(1) }),
        execute: async (input) => input,
      },
    }));

    const collected = tools.collect(serverCtx);
    expect(Object.keys(collected)).toEqual(["fixture_echo"]);

    await expect(
      collected.fixture_echo.execute({ message: "hi" }, serverCtx),
    ).resolves.toEqual({ message: "hi" });
    // Schema enforcement happens in the registry wrapper, not the handler.
    await expect(
      collected.fixture_echo.execute({ message: 42 }, serverCtx),
    ).rejects.toThrow();

    // Same plugin id can't double-register…
    expect(() => tools.register("fixture", () => ({}))).toThrow(
      ChatToolRegistrationError,
    );
    // …and a second plugin colliding on a tool name fails at collect.
    tools.register("other", () => ({
      fixture_echo: {
        description: "collides",
        inputSchema: z.object({}),
        execute: async () => null,
      },
    }));
    expect(() => tools.collect(serverCtx)).toThrow(/collision/);
  });
});
