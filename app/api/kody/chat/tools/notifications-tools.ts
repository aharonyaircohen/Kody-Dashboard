/**
 * @fileType util
 * @domain notifications
 * @pattern chat-tools
 * @ai-summary Chat tools to manage notification rules (stored in the per-repo
 *   kody:notifications-manifest issue) — list, create, delete. Rules fan a
 *   matching event out to a channel (Slack/Discord/Telegram/webhook/web-push).
 *   Mutations go through the CAS-based mutateNotificationsManifest helper.
 */
import { tool } from "ai";
import { z } from "zod";
import {
  type NotificationRule,
  type NotificationChannel,
  NOTIFICATION_EVENTS,
  slugifyRuleName,
  uniqueRuleId,
} from "@dashboard/lib/notifications";
import {
  mutateNotificationsManifest,
  readNotificationsManifestFresh,
} from "@dashboard/lib/notifications-server";

const ChannelSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("slack-webhook"), url: z.string().url() }),
  z.object({
    type: z.literal("telegram-bot"),
    botToken: z.string().min(1),
    chatId: z.string().min(1),
  }),
  z.object({ type: z.literal("discord-webhook"), url: z.string().url() }),
  z.object({
    type: z.literal("generic-webhook"),
    url: z.string().url(),
    jsonTemplate: z.string().optional(),
    bodyFormat: z.enum(["json", "form"]).optional(),
    headers: z.record(z.string()).optional(),
  }),
  z.object({ type: z.literal("web-push") }),
]);

export function createNotificationTools(opts: { owner: string; repo: string }) {
  const repoRef = `${opts.owner}/${opts.repo}`;
  return {
    list_notification_rules: tool({
      description: `List the notification rules for ${repoRef}. Each rule fans a matching event (${NOTIFICATION_EVENTS.join(", ")}) out to a channel.`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const { manifest } = await readNotificationsManifestFresh();
          return {
            rules: manifest.rules.map((r) => ({
              id: r.id,
              name: r.name,
              enabled: r.enabled,
              event: r.event,
              channelType: r.channel.type,
            })),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    create_notification_rule: tool({
      description: `Create a notification rule for ${repoRef}: when \`event\` fires, deliver to \`channel\`. Channel is one of slack-webhook / discord-webhook (need url), telegram-bot (botToken + chatId), generic-webhook (url + optional template), or web-push.`,
      inputSchema: z.object({
        name: z.string().min(1).max(80),
        event: z.enum(NOTIFICATION_EVENTS),
        channel: ChannelSchema,
        template: z.string().max(2000).optional(),
        enabled: z.boolean().optional(),
      }),
      execute: async (input) => {
        try {
          const result = await mutateNotificationsManifest((manifest) => {
            const id = uniqueRuleId(slugifyRuleName(input.name), manifest.rules);
            const rule: NotificationRule = {
              id,
              name: input.name,
              enabled: input.enabled ?? true,
              event: input.event,
              channel: input.channel as NotificationChannel,
              template: input.template,
              createdAt: new Date().toISOString(),
            };
            return { next: { ...manifest, rules: [...manifest.rules, rule] }, result: rule };
          });
          const rule = "result" in result ? result.result : null;
          return { ok: true, rule };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    delete_notification_rule: tool({
      description: `Delete a notification rule from ${repoRef} by its id (get ids from list_notification_rules).`,
      inputSchema: z.object({ id: z.string().min(1) }),
      execute: async ({ id }) => {
        try {
          const result = await mutateNotificationsManifest((manifest) => {
            const existed = manifest.rules.some((r) => r.id === id);
            return {
              next: { ...manifest, rules: manifest.rules.filter((r) => r.id !== id) },
              result: existed,
            };
          });
          const existed = "result" in result ? result.result : false;
          if (!existed) return { error: `rule "${id}" not found` };
          return { ok: true, action: "deleted", id };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
