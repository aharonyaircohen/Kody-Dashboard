/**
 * @fileType utility
 * @domain kody
 * @pattern inbox-channel-adapter
 * @ai-summary SERVER-ONLY inbox delivery — the durable dashboard inbox as a
 *   named channel adapter, peer to web-push/Slack/Discord. Given a normalized
 *   event and its resolved recipients, it appends one feed entry per recipient
 *   to the shared inbox-feed manifest. The CTO backpressure cap lives here as a
 *   post-resolve admission filter (it gates which recommendation entries are
 *   admitted, per-staff, at this single write point). Best-effort: never throws
 *   so a feed-write failure can't stop the push fan-out or break the webhook ACK.
 */
import "server-only";
import { setGitHubContext, clearGitHubContext } from "../../github-client";
import { appendInboxFeed, readInboxFeed } from "../../inbox/feed-server";
import { feedEntryId, type InboxFeedEntry } from "../../inbox/feed";
import { buildSnippet } from "../../inbox/types";
import {
  parseCtoAction,
  parseCtoCommand,
  parseCtoStaff,
  parseCtoDuty,
} from "../../cto/recommendation";
import { readCtoDecisions } from "../../cto/decisions-server";
import { latestCtoDecisions } from "../../cto/decisions";
import { applyCtoBackpressure } from "../../cto/backpressure";
import { dashboardChannelUrl } from "../../thread-link";
import { logger } from "../../logger";
import { classifyNotificationType } from "../notification-types";
import type { SourceEvent } from "../source-event";

/**
 * Append one inbox-feed entry per recipient. Skips events with no deep-linkable
 * url (the inbox needs a clickable target). Channel messages deep-link into the
 * in-app /messages view; everything else keeps its github.com anchor.
 */
export async function deliverInbox(
  ev: SourceEvent,
  recipients: string[],
  ctx: { owner: string; repo: string; token: string },
): Promise<void> {
  const url = ev.channel
    ? dashboardChannelUrl({
        channelNumber: ev.channel.number,
        commentId: ev.channel.commentId,
      })
    : ev.url;
  if (!url) return;

  const sentAt = new Date().toISOString();
  const snippet = buildSnippet(ev.body);
  // Parse the CTO verb from the *raw* body now, while backticks are intact —
  // the snippet collapses them and loses it.
  const ctoAction = parseCtoAction(ev.body ?? "");
  const ctoCommand = parseCtoCommand(ev.body ?? "");
  const ctoStaff = parseCtoStaff(ev.body ?? "");
  const ctoDuty = parseCtoDuty(ev.body ?? "");
  // Same classifier the mute filter keys on — stamp it on the entry so the
  // inbox row can offer a one-click "Mute this type" for the right category.
  const category = classifyNotificationType(ev);
  const entries: InboxFeedEntry[] = recipients.map((login) => ({
    id: feedEntryId(login, url),
    login,
    source: "mention",
    repoFullName: ev.repoFullName,
    threadType: ev.threadType,
    title: ev.title ?? "",
    snippet,
    author: ev.author,
    url,
    sentAt,
    ...(ctoAction ? { ctoAction } : {}),
    ...(ctoCommand ? { ctoCommand } : {}),
    ...(ctoStaff ? { ctoStaff } : {}),
    ...(ctoDuty ? { ctoDuty } : {}),
    ...(category ? { category } : {}),
  }));

  setGitHubContext(ctx.owner, ctx.repo, ctx.token);
  try {
    // Code-enforced cap on pending CTO recommendations. The cto.md staff
    // member is told to stop at 10 but counts by hand and drifts; this gate
    // makes it deterministic at the single write point. Both reads are cached
    // (ETag/304) — no extra GitHub budget on the webhook path.
    let toAppend = entries;
    try {
      const [feed, ledger] = await Promise.all([
        readInboxFeed(),
        readCtoDecisions(),
      ]);
      const { admitted, withheld } = applyCtoBackpressure(
        feed.entries,
        entries,
        latestCtoDecisions(ledger),
      );
      toAppend = admitted;
      if (withheld.length > 0) {
        logger.info(
          {
            event: "cto_backpressure_withheld",
            withheld: withheld.length,
            repo: ev.repoFullName,
          },
          `CTO backpressure: withheld ${withheld.length} recommendation(s) — operator queue full (max 10 pending)`,
        );
      }
    } catch (bpErr) {
      // Fail open on the gate (never silently drop real mentions): if the
      // ledger/feed read fails, append as before rather than block delivery.
      logger.warn(
        {
          event: "cto_backpressure_skipped",
          error: bpErr instanceof Error ? bpErr.message : String(bpErr),
          repo: ev.repoFullName,
        },
        "CTO backpressure check failed — appending without gate",
      );
    }

    const added = await appendInboxFeed(toAppend);
    logger.info(
      {
        event: "inbox_feed_appended",
        added,
        mentions: recipients,
        repo: ev.repoFullName,
      },
      `Inbox feed: +${added} entr${added === 1 ? "y" : "ies"}`,
    );
  } catch (err) {
    logger.warn(
      {
        event: "inbox_feed_append_failed",
        error: err instanceof Error ? err.message : String(err),
        repo: ev.repoFullName,
      },
      "Inbox feed append failed — web-push still proceeds",
    );
  } finally {
    clearGitHubContext();
  }
}
