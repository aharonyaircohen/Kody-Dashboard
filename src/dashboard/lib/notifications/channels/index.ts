/**
 * @fileType utility
 * @domain kody
 * @pattern notifications-channels-client-barrel
 * @ai-summary CLIENT-SAFE barrel for channel adapters. Only exports types
 *   and `validateChannel` — anything else (the `sendNotification` dispatch +
 *   its server-only adapters like `web-push`) lives in `./send.ts` and must
 *   only be imported from server code.
 *
 *   This split exists because `NotificationsManager.tsx` (a client
 *   component) imports `validateChannel`, and the web-push adapter pulls in
 *   Node built-ins (`net`, `tls`) via the `web-push` package. Keeping the
 *   sends in a separate module means webpack never traces those Node deps
 *   into the client bundle.
 */
import type { NotificationChannel } from "../../notifications";
import { validateSlack } from "./slack";
import { validateTelegram } from "./telegram";
import { validateDiscord } from "./discord";
import { validateGeneric } from "./generic";
import { validateWebPush } from "./web-push-validate";

export interface SendContext {
  /** The rendered template string. Adapters MAY use it directly or wrap it. */
  text: string;
  /** Substitution context (already used to render `text`); some adapters
   *  re-use it for channel-specific templates (generic-webhook). */
  vars: Record<string, string>;
  /** GitHub auth context. Required only for channels that read repo state
   *  during send (currently `web-push`, which reads the subscriptions
   *  manifest). The dispatcher fills this in; channels that don't need it
   *  ignore it. */
  github?: {
    owner: string;
    repo: string;
    token: string;
  };
}

/**
 * Per-channel-type validation for the rule editor / API. Returns null when
 * valid, otherwise a short user-facing message. Pure functions — no network
 * I/O, so safe in client bundles.
 */
export function validateChannel(channel: NotificationChannel): string | null {
  switch (channel.type) {
    case "slack-webhook":
      return validateSlack(channel);
    case "telegram-bot":
      return validateTelegram(channel);
    case "discord-webhook":
      return validateDiscord(channel);
    case "generic-webhook":
      return validateGeneric(channel);
    case "web-push":
      return validateWebPush(channel);
  }
}

// `sendNotification` is server-only — import it from "./send" in server code.
