/**
 * @fileType utility
 * @domain kody
 * @pattern notifications-channels
 * @ai-summary Channel adapter dispatch. One file per transport (slack,
 *   telegram, discord, generic). Each adapter exposes `send(channel, text)`
 *   and `validate(channel)`. The dispatcher only knows the union — no
 *   transport-specific code leaks into the dispatcher.
 */
import type { NotificationChannel } from "../../notifications";
import { sendSlack, validateSlack } from "./slack";
import { sendTelegram, validateTelegram } from "./telegram";
import { sendDiscord, validateDiscord } from "./discord";
import { sendGeneric, validateGeneric } from "./generic";

export interface SendContext {
  /** The rendered template string. Adapters MAY use it directly or wrap it. */
  text: string;
  /** Substitution context (already used to render `text`); some adapters
   *  re-use it for channel-specific templates (generic-webhook). */
  vars: Record<string, string>;
}

export async function sendNotification(
  channel: NotificationChannel,
  ctx: SendContext,
): Promise<void> {
  switch (channel.type) {
    case "slack-webhook":
      return sendSlack(channel, ctx);
    case "telegram-bot":
      return sendTelegram(channel, ctx);
    case "discord-webhook":
      return sendDiscord(channel, ctx);
    case "generic-webhook":
      return sendGeneric(channel, ctx);
  }
}

/**
 * Per-channel-type validation for the rule editor / API. Returns null when
 * valid, otherwise a short user-facing message.
 */
export function validateChannel(channel: NotificationChannel): string | null {
  switch (channel.type) {
    case "slack-webhook":
      return validateSlack(channel);
    case "telegram-bot":
      return validateTelegram(channel);
    case "discord-webhook":
      return validateDiscord(channel);
    case "generic-webhook":
      return validateGeneric(channel);
  }
}
