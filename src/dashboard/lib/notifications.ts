/**
 * @fileType utility
 * @domain kody
 * @pattern notifications-manifest
 * @ai-summary Notification rules live in a single "manifest" GitHub issue
 *   labelled `kody:notifications-manifest` whose body carries a JSON block
 *   between HTML comment markers. Mirrors the goals-manifest pattern exactly
 *   (label, comment markers, fenced JSON, server-side CAS via mutex). A rule
 *   ties one event to one channel (slack-webhook for now) with an optional
 *   message template.
 *
 *   Note on secrets: Slack webhook URLs are stored in the issue body. They
 *   are post-only URLs (one channel) — if the repo is private only
 *   collaborators can read them. The dashboard surfaces a warning. A future
 *   iteration can move URLs to repo Actions variables and reference them by
 *   name, but that requires the dashboard to read repo vars (not currently
 *   wired) — out of scope for v1.
 */

import { slugifyTitle } from "./slug";

export const NOTIFICATIONS_MANIFEST_LABEL = "kody:notifications-manifest";
export const MANIFEST_START = "<!-- kody-notifications-start -->";
export const MANIFEST_END = "<!-- kody-notifications-end -->";
export const MANIFEST_ISSUE_TITLE = "Kody Notifications Manifest";

/**
 * Events the dashboard can fire notifications on. Currently only
 * release/deploy-merged is wired through the webhook handler. The others are
 * declared so the UI can render them and rules can be authored ahead of the
 * dispatcher learning to fire them.
 */
export const NOTIFICATION_EVENTS = [
  "deploy_pr_merged",
  "release_failed",
  "task_failed",
  "task_completed",
  "ci_failed",
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const CHANNEL_TYPES = [
  "slack-webhook",
  "telegram-bot",
  "discord-webhook",
  "generic-webhook",
  "web-push",
] as const;

export type ChannelType = (typeof CHANNEL_TYPES)[number];

/**
 * Discriminated union over channel transport. Adding a new channel = add a
 * variant here, add an adapter under `notifications/channels/`, and add a
 * Zod variant in the API route's `channelSchema`.
 */
export type NotificationChannel =
  | { type: "slack-webhook"; url: string }
  | { type: "telegram-bot"; botToken: string; chatId: string }
  | { type: "discord-webhook"; url: string }
  | {
      type: "generic-webhook";
      url: string;
      /**
       * Optional template POSTed as the body. Variables substituted the
       * same way as the rule's top-level `template`. Shape depends on
       * `bodyFormat`:
       *   - "json" (default): rendered string must be valid JSON; sent
       *     with Content-Type: application/json. Omit to send
       *     `{"text": "<rendered top-level template>"}`.
       *   - "form": rendered string must be valid JSON of a FLAT object
       *     `{ key: "value", ... }`; sent URL-form-encoded with
       *     Content-Type: application/x-www-form-urlencoded. Required for
       *     APIs like Twilio.
       */
      jsonTemplate?: string;
      bodyFormat?: "json" | "form";
      headers?: Record<string, string>;
    }
  | {
      /**
       * Web Push (PWA). Unlike the other channels there's no per-channel
       * destination — subscriptions live in a separate per-repo manifest
       * (`kody:push-subscriptions`) and the adapter fans out to every
       * subscribed device. Adding `web-push` to a rule means "every
       * subscribed device on this repo gets a notification for this event".
       */
      type: "web-push";
    };

export function channelTypeLabel(type: ChannelType): string {
  switch (type) {
    case "slack-webhook":
      return "Slack (incoming webhook)";
    case "telegram-bot":
      return "Telegram (bot API)";
    case "discord-webhook":
      return "Discord (webhook)";
    case "generic-webhook":
      return "Generic webhook (custom HTTP POST)";
    case "web-push":
      return "Web Push (mobile/desktop PWA)";
  }
}

export interface NotificationRule {
  id: string;
  name: string;
  enabled: boolean;
  event: NotificationEvent;
  channel: NotificationChannel;
  /**
   * Mustache-lite template. Variables substituted at dispatch time:
   *   {{repo}}, {{prUrl}}, {{prTitle}}, {{prBody}}, {{author}}, {{version}}
   * Empty string → use a sensible default per event.
   */
  template?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface NotificationsManifest {
  version: 1;
  rules: NotificationRule[];
}

export const EMPTY_MANIFEST: NotificationsManifest = { version: 1, rules: [] };

export function isNotificationEvent(v: unknown): v is NotificationEvent {
  return (
    typeof v === "string" &&
    (NOTIFICATION_EVENTS as readonly string[]).includes(v)
  );
}

function isChannel(v: unknown): v is NotificationChannel {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  switch (c.type) {
    case "slack-webhook":
    case "discord-webhook":
      return typeof c.url === "string" && c.url.length > 0;
    case "telegram-bot":
      return (
        typeof c.botToken === "string" &&
        c.botToken.length > 0 &&
        typeof c.chatId === "string" &&
        c.chatId.length > 0
      );
    case "generic-webhook":
      return typeof c.url === "string" && c.url.length > 0;
    case "web-push":
      // No per-channel config; presence of the type tag is sufficient.
      return true;
    default:
      return false;
  }
}

/**
 * Best-effort sanitizer used after JSON.parse to drop unknown fields and
 * coerce optional values into the right shape. Returns null when the input
 * isn't a recognizable channel.
 */
function sanitizeChannel(v: unknown): NotificationChannel | null {
  if (!isChannel(v)) return null;
  const c = v as Record<string, unknown>;
  switch (c.type) {
    case "slack-webhook":
      return { type: "slack-webhook", url: String(c.url) };
    case "telegram-bot":
      return {
        type: "telegram-bot",
        botToken: String(c.botToken),
        chatId: String(c.chatId),
      };
    case "discord-webhook":
      return { type: "discord-webhook", url: String(c.url) };
    case "generic-webhook": {
      const headers =
        c.headers && typeof c.headers === "object" && !Array.isArray(c.headers)
          ? Object.fromEntries(
              Object.entries(c.headers as Record<string, unknown>)
                .filter(([, v]) => typeof v === "string")
                .map(([k, v]) => [k, String(v)]),
            )
          : undefined;
      const bodyFormat: "json" | "form" =
        c.bodyFormat === "form" ? "form" : "json";
      return {
        type: "generic-webhook",
        url: String(c.url),
        jsonTemplate:
          typeof c.jsonTemplate === "string" ? c.jsonTemplate : undefined,
        bodyFormat: bodyFormat === "form" ? "form" : undefined,
        headers:
          headers && Object.keys(headers).length > 0 ? headers : undefined,
      };
    }
    case "web-push":
      return { type: "web-push" };
    default:
      return null;
  }
}

export function parseManifestBody(
  body: string | null | undefined,
): NotificationsManifest {
  if (!body) return { version: 1, rules: [] };
  const start = body.indexOf(MANIFEST_START);
  const end = body.indexOf(MANIFEST_END);
  if (start === -1 || end === -1 || end < start) {
    return { version: 1, rules: [] };
  }
  const inner = body.slice(start + MANIFEST_START.length, end);
  const fenceOpen = inner.indexOf("```");
  const fenceClose = inner.lastIndexOf("```");
  if (fenceOpen === -1 || fenceClose === -1 || fenceClose === fenceOpen) {
    return { version: 1, rules: [] };
  }
  const afterOpenNewline = inner.indexOf("\n", fenceOpen);
  if (afterOpenNewline === -1) return { version: 1, rules: [] };
  const json = inner.slice(afterOpenNewline + 1, fenceClose).trim();
  if (!json) return { version: 1, rules: [] };

  try {
    const parsed = JSON.parse(json) as Partial<NotificationsManifest>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.rules)) {
      return { version: 1, rules: [] };
    }
    const rules: NotificationRule[] = [];
    for (const r of parsed.rules) {
      if (!r || typeof r !== "object") continue;
      const rule = r as NotificationRule;
      if (
        typeof rule.id !== "string" ||
        typeof rule.name !== "string" ||
        !isNotificationEvent(rule.event)
      ) {
        continue;
      }
      const channel = sanitizeChannel(rule.channel);
      if (!channel) continue;
      rules.push({
        id: rule.id,
        name: rule.name,
        enabled: rule.enabled !== false,
        event: rule.event,
        channel,
        template: typeof rule.template === "string" ? rule.template : undefined,
        createdAt: rule.createdAt ?? new Date().toISOString(),
        updatedAt: rule.updatedAt,
      });
    }
    return { version: 1, rules };
  } catch {
    return { version: 1, rules: [] };
  }
}

export function serializeManifestBody(manifest: NotificationsManifest): string {
  const preamble =
    "> Kody notifications manifest — the dashboard reads and writes the JSON block below.\n" +
    "> Prefer editing via the UI (`/notifications`) to avoid merge conflicts.\n" +
    "> ⚠️ Slack webhook URLs are sensitive — keep this repo private.\n\n";
  const json = JSON.stringify(manifest, null, 2);
  return `${preamble}${MANIFEST_START}\n\n\`\`\`json\n${json}\n\`\`\`\n\n${MANIFEST_END}\n`;
}

export function slugifyRuleName(name: string): string {
  return slugifyTitle(name, {
    maxLength: 60,
    fallback: "rule",
    allowUnderscore: false,
  });
}

export function uniqueRuleId(
  base: string,
  existing: NotificationRule[],
): string {
  const taken = new Set(existing.map((r) => r.id));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/**
 * Substitute `{{var}}` tokens in a template against a context. Unknown
 * tokens stay as-is so the message still renders something readable.
 */
export function renderTemplate(
  template: string,
  ctx: Record<string, string | undefined>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const v = ctx[key];
    return v === undefined ? `{{${key}}}` : v;
  });
}

export function defaultTemplateForEvent(event: NotificationEvent): string {
  switch (event) {
    case "deploy_pr_merged":
      return ":rocket: *{{repo}}* `{{version}}` deployed — {{prUrl}}";
    case "release_failed":
      return ":x: *{{repo}}* release failed — {{prUrl}}";
    case "task_completed":
      return ":white_check_mark: *{{repo}}* task done — {{prUrl}}";
    case "task_failed":
      return ":warning: *{{repo}}* task failed — {{prUrl}}";
    case "ci_failed":
      return ":no_entry: *{{repo}}* CI failed — {{prUrl}}";
  }
}

export function eventLabel(event: NotificationEvent): string {
  switch (event) {
    case "deploy_pr_merged":
      return "Deploy PR merged (release shipped)";
    case "release_failed":
      return "Release flow failed";
    case "task_completed":
      return "Task completed";
    case "task_failed":
      return "Task failed";
    case "ci_failed":
      return "CI failed on a PR";
  }
}
