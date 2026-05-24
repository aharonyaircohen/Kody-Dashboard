/**
 * @fileType utility
 * @domain kody
 * @pattern notification-recipient-resolver
 * @ai-summary The single answer to "who should this event notify?". Every
 *   recipient decision used to be smeared across the dispatchers — the mention
 *   scrape lived in `mention-dispatch`, the channel-broadcast subscriber filter
 *   lived inline next to it, each re-deciding who gets pinged. This module owns
 *   it: `resolveRecipients(event, subscriptions)` returns the human logins to
 *   notify, applying the two recipient policies the dashboard has —
 *
 *     • mention-gated (the default): humans `@mentioned` in the body. Mentions
 *       inside code spans are ignored (GitHub doesn't notify for those) and the
 *       bot's own command handle (`@kody`/`@kodyade`) is never a recipient —
 *       otherwise orchestrator trigger comments (`@kody sync --pr 12`) and
 *       quoted commands flood the inbox.
 *     • channel broadcast (a `#`-titled discussion): every subscriber except
 *       the author, honoring each one's `channelNotify` preference.
 *
 *   Pure and side-effect free → unit-tested in isolation.
 */
import type { PushSubscriptionRecord } from "../push";

// GitHub login: 1–39 chars, alphanumeric or single hyphens, not starting/
// ending with hyphen. The leading-char class also keeps emails and
// `user@host` references from matching.
const MENTION_RE = /(^|[^A-Za-z0-9_/-])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\b/g;

/**
 * Logins that are the Kody bot itself, never a human operator. `@kody` is the
 * engine's command handle — orchestrator trigger comments (`@kody sync --pr 12`,
 * `@kody bug --base …`) and CTO recommendations that quote the command the
 * operator should run all carry a literal `@kody`. Recording those as inbox
 * mentions floods the shared feed and evicts real operator mentions. No human
 * reads a "kody" inbox, so they're never valid recipients. `kodyade` is the
 * bot's GitHub account, dropped for the same reason.
 */
const BOT_MENTION_HANDLES = new Set(["kody", "kodyade"]);

/**
 * Blank out inline code spans and fenced code blocks before scanning for
 * mentions. GitHub itself does not notify for an `@mention` inside code, and
 * the engine deliberately backtick-wraps neutralized command directives
 * (`@kody sync …`) — so a mention inside code is never a real ping.
 */
function stripCode(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ");
}

export function extractMentions(body: string | null | undefined): string[] {
  if (!body) return [];
  const found = new Set<string>();
  for (const m of stripCode(body).matchAll(MENTION_RE)) {
    const lc = m[2]?.toLowerCase();
    if (!lc) continue;
    // The bot's own command handle is a directive, not a person to notify.
    if (BOT_MENTION_HANDLES.has(lc)) continue;
    found.add(lc);
  }
  return [...found];
}

/** The minimal event shape the resolver reads. */
export interface RecipientEvent {
  body: string;
  author?: string;
  /** Set for `#`-titled discussion comments — triggers channel broadcast. */
  channel?: { number: number; commentId?: number };
}

export interface RecipientResolution {
  /** Lowercased logins to notify. */
  logins: string[];
  /** True when this was a channel broadcast (inbox skip + /messages deep-link). */
  isChannelBroadcast: boolean;
}

/**
 * Resolve who to notify for an event. Channel messages broadcast to every
 * subscriber except the author (honoring `channelNotify`); everything else is
 * gated to the humans `@mentioned` in the body.
 */
export function resolveRecipients(
  ev: RecipientEvent,
  subscriptions: PushSubscriptionRecord[],
): RecipientResolution {
  if (ev.channel) {
    const authorLc = ev.author?.toLowerCase();
    const mentioned = new Set(extractMentions(ev.body));
    // Per-subscription preference: `off` opts out entirely, `mentions` only
    // fires when @mentioned, `all`/undefined gets every message.
    const wantsChannel = (s: PushSubscriptionRecord): boolean => {
      const login = s.userLogin?.toLowerCase();
      if (!login || login === authorLc) return false;
      if (s.channelNotify === "off") return false;
      if (s.channelNotify === "mentions") return mentioned.has(login);
      return true;
    };
    const logins = [
      ...new Set(
        subscriptions
          .filter(wantsChannel)
          .map((s) => s.userLogin!.toLowerCase()),
      ),
    ];
    return { logins, isChannelBroadcast: true };
  }
  return { logins: extractMentions(ev.body), isChannelBroadcast: false };
}
