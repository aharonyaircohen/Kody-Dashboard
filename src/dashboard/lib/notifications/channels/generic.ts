/**
 * @fileType utility
 * @domain kody
 * @pattern generic-webhook-adapter
 * @ai-summary Generic outbound-webhook adapter — the "I just want to POST
 *   to my own endpoint" escape hatch for channels Slack/Discord/Telegram
 *   don't cover. Auth is whatever the user puts in the per-channel `headers`
 *   (e.g. `Authorization: Bearer …`); the URL itself is `https:`-only.
 *   Body is either a user-supplied `{{var}}` template or a default
 *   `{ "text": <rendered> }`, with two formats:
 *     - "json" (default) — sends `Content-Type: application/json`
 *     - "form" — template must render to a flat JSON object, sent as
 *       `application/x-www-form-urlencoded` (this is what Twilio and most
 *       "old-school" REST APIs want).
 *   Trap: `form` mode is the most error-prone — a nested object or
 *   non-scalar value throws at send time, not at validation time, and
 *   user-defined `Content-Type` headers silently win over the default.
 *   No retry, no signing, no payload-size cap.
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(renderTemplate(c.jsonTemplate, {}));
    } catch {
      return "Template doesn't parse as JSON after rendering";
    }
    if (c.bodyFormat === "form") {
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return 'Form body requires a flat JSON object: {"key": "value", ...}';
      }
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (
          typeof v !== "string" &&
          typeof v !== "number" &&
          typeof v !== "boolean"
        ) {
          return `Form body key "${k}" must be a string, number, or boolean`;
        }
      }
    }
  } else if (c.bodyFormat === "form") {
    return "Form body format requires a JSON object template";
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

function encodeForm(obj: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    params.append(k, String(v));
  }
  return params.toString();
}

export async function sendGeneric(c: Channel, ctx: SendContext): Promise<void> {
  const headers: Record<string, string> = { ...(c.headers ?? {}) };
  let body: string;

  const format = c.bodyFormat ?? "json";
  if (format === "form") {
    if (!c.jsonTemplate) {
      throw new Error("Form body requires a JSON object template");
    }
    const rendered = renderTemplate(c.jsonTemplate, ctx.vars);
    let obj: unknown;
    try {
      obj = JSON.parse(rendered);
    } catch (err) {
      throw new Error(
        `Form template didn't render to JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      throw new Error("Form body must render to a flat JSON object");
    }
    body = encodeForm(obj as Record<string, unknown>);
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
  } else {
    if (c.jsonTemplate) {
      body = renderTemplate(c.jsonTemplate, ctx.vars);
    } else {
      body = JSON.stringify({ text: ctx.text });
    }
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
  }

  const res = await fetch(c.url, { method: "POST", headers, body });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Webhook ${res.status}: ${detail.slice(0, 200)}`);
  }
}
