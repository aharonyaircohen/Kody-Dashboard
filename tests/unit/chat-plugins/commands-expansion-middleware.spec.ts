/**
 * @fileoverview Behavior contract for the commands plugin's slash-expansion
 *   send middleware (Step 5b — REWRITE of the retired source-text spec
 *   `kodychat-slash-command-bubble.spec.ts`, issue #140). Typing
 *   `/slug args` and sending must ship the EXPANDED command body to the
 *   model (chain output) while the user bubble shows the RAW typed text
 *   (host-effect payload → `displayContent`). Terminal intents skip
 *   expansion because the order-100 terminal middleware already rewrote
 *   them; unknown slugs pass through untouched. The e2e complement is the
 *   admin-regression slash-menu case (DOM contract).
 * @testFramework vitest
 * @domain chat-plugins
 */
import { describe, expect, it } from "vitest";

import {
  FULL_GRANT,
  createChatPluginRegistry,
  type ChatHostEffect,
} from "@kody-ade/kody-chat/platform";
import {
  SLASH_COMMANDS_HOST_KEY,
  SLASH_EXPANSION_EFFECT,
  SLASH_EXPANSION_MIDDLEWARE_ID,
  commandsChatPlugin,
  readSlashExpansionEffect,
  type SlashCommand,
} from "@kody-ade/kody-chat/plugins/commands";
import {
  TERMINAL_INTENT_MIDDLEWARE_ID,
  readTerminalIntentEffect,
  terminalChatPlugin,
} from "@kody-chat/chat/plugins/terminal";
import { buildKodyTerminalPrompt } from "@dashboard/lib/terminal/kody-terminal-directive";

const COMMANDS: SlashCommand[] = [
  {
    slug: "plan",
    description: "Plan work",
    argumentHint: "<feature>",
    body: "Research first, then plan: $ARGUMENTS",
    source: "builtin",
  },
  {
    slug: "review",
    description: "Review",
    argumentHint: "",
    body: "Review this PR.",
    source: "repo",
  },
  {
    // A hostile fixture: a repo command whose slug collides with the
    // terminal directive. The order-100 rewrite must still win.
    slug: "terminal",
    description: "Decoy",
    argumentHint: "",
    body: "NEVER SENT for /terminal intents",
    source: "repo",
  },
];

function makeChain(commands: unknown = COMMANDS) {
  const registry = createChatPluginRegistry();
  // Register commands FIRST — precedence must come from `order`, not
  // registration sequence.
  registry.register(commandsChatPlugin, FULL_GRANT);
  registry.register(terminalChatPlugin, FULL_GRANT);
  const effects: ChatHostEffect[] = [];
  const run = (text: string) =>
    registry.runSendMiddleware(text, {
      host: { [SLASH_COMMANDS_HOST_KEY]: commands },
      dispatchHostEffect: (effect) => effects.push(effect),
    });
  return { registry, effects, run };
}

describe("slash-expansion middleware (commands plugin, order 200)", () => {
  it("orders after the terminal-intent middleware regardless of registration order", () => {
    const { registry } = makeChain();
    expect(registry.middleware().map((m) => m.id)).toEqual([
      TERMINAL_INTENT_MIDDLEWARE_ID,
      SLASH_EXPANSION_MIDDLEWARE_ID,
    ]);
  });

  it("ships the expanded body ($ARGUMENTS substituted) as the sent text", () => {
    const { run } = makeChain();
    const outcome = run("/plan dark mode");
    expect(outcome.text).toBe("Research first, then plan: dark mode");
    expect(outcome.consumedBy).toBeUndefined();
  });

  it("hands the raw typed text back for the user bubble via the host effect", () => {
    const { run, effects } = makeChain();
    run("/plan dark mode");
    expect(effects).toHaveLength(1);
    const payload = readSlashExpansionEffect(effects[0]);
    // The bubble (displayContent) shows what the user typed; the model
    // receives the expanded body — never the other way around.
    expect(payload).toEqual({
      rawText: "/plan dark mode",
      slug: "plan",
      text: "Research first, then plan: dark mode",
      hadPlaceholder: true,
    });
  });

  it("expands argument-less commands and reports hadPlaceholder=false", () => {
    const { run, effects } = makeChain();
    const outcome = run("/review");
    expect(outcome.text).toBe("Review this PR.");
    expect(readSlashExpansionEffect(effects[0])?.hadPlaceholder).toBe(false);
  });

  it("passes unknown slugs and plain text through with no effect", () => {
    const { run, effects } = makeChain();
    expect(run("/nope x").text).toBe("/nope x");
    expect(run("plain message").text).toBe("plain message");
    expect(run("/").text).toBe("/");
    expect(effects).toHaveLength(0);
  });

  it("never expands terminal intents — the order-100 rewrite wins even on a slug collision", () => {
    const { run, effects } = makeChain();
    const outcome = run("/terminal ls -la");
    // The terminal middleware rewrote the text to the Kody prompt (which
    // no longer starts with "/"), so expansion has nothing to match.
    expect(outcome.text).toBe(buildKodyTerminalPrompt("ls -la"));
    expect(effects).toHaveLength(1);
    expect(readTerminalIntentEffect(effects[0])).not.toBeNull();
    expect(readSlashExpansionEffect(effects[0])).toBeNull();
  });

  it("passes through when the host carries no usable command list", () => {
    // `null` (not `undefined`) so the fixture default never kicks in —
    // the middleware itself treats any non-array as "no commands".
    for (const commands of [null, "bogus", [], [{ slug: 42 }]]) {
      const { run, effects } = makeChain(commands);
      expect(run("/plan x").text).toBe("/plan x");
      expect(effects).toHaveLength(0);
    }
  });

  it("ignores foreign or malformed effects when reading the expansion payload", () => {
    expect(readSlashExpansionEffect({ kind: "other:effect" })).toBeNull();
    expect(
      readSlashExpansionEffect({
        kind: SLASH_EXPANSION_EFFECT,
        payload: { rawText: "/plan x" },
      }),
    ).toBeNull();
  });
});
