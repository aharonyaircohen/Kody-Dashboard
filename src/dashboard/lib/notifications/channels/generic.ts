/**
 * Generic webhook adapter. POSTs to an arbitrary URL with optional custom
 * headers. The body is either a user-supplied JSON template (rendered with
 * the same `{{var}}` substitution) or a default `{ "text": "<rendered>" }`
 * shape that mirrors Slack/Discord.
 */
import type { NotificationChannel } from "../../notifications";
import { renderTemplate } from "../../notifications";
import type { SendContext } from "./index";

type Channel = Extract<NotificationChannel, { type: "generic-webhook" }>;

export function validateGeneric(c: Channel): string | null {
  try {
    const u = new URL(c.url);
    if (u.protocol !== "https:") return "URL must use https";
  } catch {
    return "Not a valid URL";
  }
  if (c.jsonTemplate) {
    try {
      // The TEMPLATE itself need not be parseable JSON (it can have
      // unsubstituted {{vars}} that aren't valid JSON), but it must
      // become valid JSON after a no-op render. Sanity-check the
      // rendered form here so a typo doesn't blow up at dispatch time.
      JSON.parse(renderTemplate(c.jsonTemplate, {}));
    } catch {
      return "JSON template doesn't parse as JSON after rendering";
    }
  }
  if (c.headers) {
    for (const [k] of Object.entries(c.headers)) {
      if (!/^[A-Za-z0-9-]+$/.test(k)) {
        return `Header name "${k}" has invalid characters`;
      }
    }
  }
  return null;
}

export async function sendGeneric(
  c: Channel,
  ctx: SendContext,
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(c.headers ?? {}),
  };
  let body: string;
  if (c.jsonTemplate) {
    body = renderTemplate(c.jsonTemplate, ctx.vars);
  } else {
    body = JSON.stringify({ text: ctx.text });
  }
  const res = await fetch(c.url, { method: "POST", headers, body });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Webhook ${res.status}: ${detail.slice(0, 200)}`);
  }
}
