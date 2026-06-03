/**
 * @fileType utility
 * @domain kody
 * @pattern discord-channel-adapter
 * @ai-summary Discord webhook adapter. POSTs `{ content }` to a channel
 *   webhook URL. Discord caps content at 2000 chars — this adapter silently
 *   truncates before sending so a long PR body never causes a 400. Throws
 *   on other non-2xx so the dispatcher can report misconfiguration.
 */
import type { NotificationChannel } from "../../notifications";
import type { SendContext } from "./index";

type Channel = Extract<NotificationChannel, { type: "discord-webhook" }>;

export function validateDiscord(c: Channel): string | null {
  if (
    !/^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\//.test(c.url)
  ) {
    return "Must be a Discord webhook URL (https://discord.com/api/webhooks/...)";
  }
  return null;
}

export async function sendDiscord(c: Channel, ctx: SendContext): Promise<void> {
  // Discord caps content at 2000 chars; truncate with an ellipsis so a
  // long PR body never causes a 400.
  const content =
    ctx.text.length > 1990 ? `${ctx.text.slice(0, 1987)}...` : ctx.text;
  const res = await fetch(c.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Discord ${res.status}: ${detail.slice(0, 200)}`);
  }
}
