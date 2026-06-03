/**
 * @fileType utility
 * @domain kody
 * @pattern telegram-channel-adapter
 * @ai-summary Telegram bot adapter. POSTs to `https://api.telegram.org/bot<token>/sendMessage`
 *   with `{ chat_id, text }`. The bot must already be a member of the target
 *   chat — the chatId is out-of-band (getUpdates, @userinfobot, etc.). Sends
 *   plain text only; users wanting HTML formatting use a generic-webhook
 *   channel instead.
 */
import type { NotificationChannel } from "../../notifications";
import type { SendContext } from "./index";

type Channel = Extract<NotificationChannel, { type: "telegram-bot" }>;

const BOT_TOKEN_RE = /^\d+:[A-Za-z0-9_-]{30,}$/;

export function validateTelegram(c: Channel): string | null {
  if (!BOT_TOKEN_RE.test(c.botToken)) {
    return 'Bot token looks malformed (expected "<bot-id>:<35-char-token>")';
  }
  if (!c.chatId.trim()) {
    return "Chat ID is required";
  }
  return null;
}

export async function sendTelegram(
  c: Channel,
  ctx: SendContext,
): Promise<void> {
  const url = `https://api.telegram.org/bot${encodeURIComponent(c.botToken)}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: c.chatId,
      // Telegram doesn't render Slack-flavored mrkdwn; send plain text.
      // Users wanting bold/links can still use HTML by setting parse_mode
      // in a generic-webhook channel instead.
      text: ctx.text,
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Telegram ${res.status}: ${detail.slice(0, 200)}`);
  }
}
