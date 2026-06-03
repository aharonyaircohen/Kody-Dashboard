/**
 * @fileType utility
 * @domain kody
 * @pattern slack-channel-adapter
 * @ai-summary Slack incoming webhook adapter. POSTs `{ text }` to the
 *   per-workspace webhook URL. Trivial and stateless — no fan-out, no
 *   subscription manifest. Throws on non-2xx so the dispatcher can surface
 *   misconfigured URLs as rule-level failures.
 */
import type { NotificationChannel } from "../../notifications";
import type { SendContext } from "./index";

type Channel = Extract<NotificationChannel, { type: "slack-webhook" }>;

export function validateSlack(c: Channel): string | null {
  if (!c.url.startsWith("https://hooks.slack.com/")) {
    return "Must be a Slack incoming webhook URL (https://hooks.slack.com/...)";
  }
  return null;
}

export async function sendSlack(c: Channel, ctx: SendContext): Promise<void> {
  const res = await fetch(c.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: ctx.text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Slack ${res.status}: ${detail.slice(0, 200)}`);
  }
}
