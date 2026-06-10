/**
 * @fileType utility
 * @domain kody
 * @pattern slack-channel-adapter
 * @ai-summary Slack incoming-webhook adapter. Single-shape POST `{ text }` to
 *   the per-workspace URL Slack generated on "Add New Webhook to Workspace".
 *   The URL is the auth — no headers, no body signing — so it MUST be treated
 *   as a secret. Trap: the validator only enforces the `hooks.slack.com/`
 *   prefix; a stolen URL posts to Slack until rotated. No retry, no rate-limit
 *   handling, no truncation — Slack's own 429 surfaces as a thrown error.
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
