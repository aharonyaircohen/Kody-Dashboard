/**
 * @fileType module
 * @domain chat-plugin-commands
 * @pattern send-middleware
 * @ai-summary Slash-expansion send middleware (order 200 — pinned to run
 *   after the terminal-intent middleware at order 100, Step 5a/5b). When
 *   the outgoing text is a `/slug args…` form whose slug matches a known
 *   command, the middleware rewrites the text to the command body with
 *   `$ARGUMENTS`/`$0`/`$1` substituted and dispatches a host effect
 *   carrying the raw typed text — the host shows the raw text in the user
 *   bubble (displayContent) while the model receives the expanded body.
 *   Terminal intents skip expansion by construction: the order-100
 *   middleware already rewrote `/terminal <x>` to the Kody terminal
 *   prompt, which no longer starts with "/". The command list is read
 *   from the host-context snapshot (`slashCommands`) because commands
 *   load asynchronously per repo while the manifest is static pure data.
 */
import type { ChatHostEffect, ChatSendMiddleware } from "../../platform";
import { expandSlashCommand, type SlashCommand } from "./useSlashCommands";

export const SLASH_EXPANSION_MIDDLEWARE_ID = "slash-expansion";
export const SLASH_EXPANSION_MIDDLEWARE_ORDER = 200;
export const SLASH_EXPANSION_EFFECT = "commands:expansion";
/** Host-context key the host fills with the fetched `SlashCommand[]`. */
export const SLASH_COMMANDS_HOST_KEY = "slashCommands";

export interface SlashExpansionEffectPayload {
  /** The raw text the user typed (shown in the user bubble). */
  rawText: string;
  /** The matched command slug. */
  slug: string;
  /** The expanded command body the model receives instead. */
  text: string;
  /** Whether the body contained an `$ARGUMENTS`-family placeholder. */
  hadPlaceholder: boolean;
}

export function readSlashExpansionEffect(
  effect: ChatHostEffect,
): SlashExpansionEffectPayload | null {
  if (effect.kind !== SLASH_EXPANSION_EFFECT) return null;
  const payload = effect.payload as Partial<SlashExpansionEffectPayload>;
  if (
    typeof payload?.rawText !== "string" ||
    typeof payload?.slug !== "string" ||
    typeof payload?.text !== "string" ||
    typeof payload?.hadPlaceholder !== "boolean"
  ) {
    return null;
  }
  return {
    rawText: payload.rawText,
    slug: payload.slug,
    text: payload.text,
    hadPlaceholder: payload.hadPlaceholder,
  };
}

/**
 * Validate the host-context command list. Expansion only reads `slug` and
 * `body`; entries missing either are dropped rather than crashing the send.
 */
function isExpandableCommand(value: unknown): value is SlashCommand {
  if (typeof value !== "object" || value === null) return false;
  const command = value as Partial<SlashCommand>;
  return typeof command.slug === "string" && typeof command.body === "string";
}

export function readHostSlashCommands(
  host: Readonly<Record<string, unknown>>,
): SlashCommand[] {
  const value = host[SLASH_COMMANDS_HOST_KEY];
  if (!Array.isArray(value)) return [];
  return value.filter(isExpandableCommand);
}

export const slashExpansionMiddleware: ChatSendMiddleware = {
  id: SLASH_EXPANSION_MIDDLEWARE_ID,
  order: SLASH_EXPANSION_MIDDLEWARE_ORDER,
  onSend(text, ctx) {
    const commands = readHostSlashCommands(ctx.host);
    if (commands.length === 0) return null;
    // Unknown slugs (and non-slash text) pass through unchanged so users
    // can still type "/"-prefixed text freely — exact pre-move semantics.
    const expanded = expandSlashCommand(text, commands);
    if (!expanded) return null;
    ctx.dispatchHostEffect({
      kind: SLASH_EXPANSION_EFFECT,
      payload: {
        rawText: text,
        slug: expanded.slug,
        text: expanded.text,
        hadPlaceholder: expanded.hadPlaceholder,
      } satisfies SlashExpansionEffectPayload,
    });
    return { text: expanded.text };
  },
};
