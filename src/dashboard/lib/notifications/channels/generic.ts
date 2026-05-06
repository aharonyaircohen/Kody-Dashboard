/**
 * Generic webhook adapter. POSTs to an arbitrary URL with optional custom
 * headers. The body is either a user-supplied template (rendered with the
 * same `{{var}}` substitution) or a default `{ "text": "<rendered>" }`.
 *
 * Body format options:
 *   - "json" (default): rendered template must be valid JSON; sent with
 *     Content-Type: application/json.
 *   - "form": rendered template must be valid JSON of a flat object
 *     `{ key: "value", ... }`; each k/v pair is URL-form-encoded and sent
 *     with Content-Type: application/x-www-form-urlencoded. This is what
 *     Twilio (and most "old-school" REST APIs) want.
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
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        return 'Form body requires a flat JSON object: {"key": "value", ...}';
      }
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
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

export async function sendGeneric(
  c: Channel,
  ctx: SendContext,
): Promise<void> {
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
