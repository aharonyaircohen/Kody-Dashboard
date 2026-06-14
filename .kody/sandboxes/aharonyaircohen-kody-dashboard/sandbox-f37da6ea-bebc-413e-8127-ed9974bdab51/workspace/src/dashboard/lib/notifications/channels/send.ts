/**
 * @fileType utility
 * @domain kody
 * @pattern notifications-channels-server-barrel
 * @ai-summary SERVER-ONLY barrel for channel adapter dispatch.
 *   `sendNotification` lives here (and not in `./index.ts`) so the channels
 *   barrel can be imported safely from client components for validation
 *   without dragging Node-only deps (e.g. `web-push` → net/tls) into the
 *   browser bundle.
 *
 *   Import path from server-only code (API routes, dispatcher):
 *     `import { sendNotification } from "@dashboard/lib/notifications/channels/send"`
 */
import "server-only";
import type { NotificationChannel } from "../../notifications";
import { sendSlack } from "./slack";
import { sendTelegram } from "./telegram";
import { sendDiscord } from "./discord";
import { sendGeneric } from "./generic";
import { sendWebPush } from "./web-push";
import type { SendContext } from "./index";

export type { SendContext };

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
    case "web-push":
      return sendWebPush(channel, ctx);
  }
}
