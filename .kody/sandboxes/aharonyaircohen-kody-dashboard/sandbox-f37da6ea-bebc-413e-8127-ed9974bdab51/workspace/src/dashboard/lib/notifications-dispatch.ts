/**
 * @fileType utility
 * @domain kody
 * @pattern notifications-dispatch
 * @ai-summary Server-only: fire-and-forget Slack notifications from webhook
 *   events. Reads the rule manifest fresh (no cache — rules can change at any
 *   time and a stale read shouldn't suppress a notification), filters by
 *   event, renders the template, POSTs to each rule's webhook URL.
 *
 *   Errors are logged and swallowed: webhook handlers must return 200
 *   quickly. A failed Slack POST should never cause GitHub to retry the
 *   whole webhook delivery.
 */
import { setGitHubContext, clearGitHubContext } from "./github-client";
import {
  defaultTemplateForEvent,
  renderTemplate,
  type NotificationEvent,
  type NotificationRule,
} from "./notifications";
import { sendNotification } from "./notifications/channels/send";
import { buildSourceEvent, type SourcePr } from "./notifications/source-event";
import { readNotificationsManifestFresh } from "./notifications-server";
import { resolveBackgroundToken } from "./auth/background-token";
import { logger } from "./logger";

interface DispatchContext {
  owner: string;
  repo: string;
  /** Bot/env token to read the manifest issue. */
  token: string;
}

/**
 * Detect whether a `pull_request: closed` event is a kody-managed release
 * deploy PR that was actually merged (not closed without merge). Recognized
 * by the title shape `deploy: <a> → <b> (v<X.Y.Z>)` produced by
 * release-deploy/deploy.sh. Em dash and ascii arrow are both accepted.
 * Consumes the normalized `SourceEvent` (action + pr) rather than the raw
 * payload, so all payload-shape knowledge lives in `buildSourceEvent`.
 */
export function isDeployPrMerged(
  action: string,
  pr: SourcePr | undefined,
): { matched: true; version: string } | { matched: false } {
  if (action !== "closed") return { matched: false };
  if (!pr?.merged) return { matched: false };
  // "deploy: dev → main (v0.25.5)" — → is the rightwards arrow
  const m = pr.title.match(/^deploy:\s+\S+\s+(?:→|->|→)\s+\S+\s+\(v([^)]+)\)/);
  if (!m) return { matched: false };
  return { matched: true, version: m[1]! };
}

/**
 * Build the substitution context from a normalized `SourcePr`. All values are
 * strings (or empty string when missing) so the template renderer never
 * produces "undefined" output.
 */
function buildPrContext(
  pr: SourcePr | undefined,
  extras: { repoFullName: string; version?: string },
): Record<string, string> {
  return {
    repo: extras.repoFullName,
    version: extras.version ?? "",
    prUrl: pr?.url ?? "",
    prTitle: pr?.title ?? "",
    prBody: pr?.body ?? "",
    author: pr?.author ?? "",
  };
}

/**
 * Read rules and fire any that match the given event. Each adapter call is
 * isolated so one failed rule doesn't suppress the others.
 */
export async function fireNotifications(
  event: NotificationEvent,
  payloadCtx: Record<string, string>,
  ctx: DispatchContext,
): Promise<void> {
  setGitHubContext(ctx.owner, ctx.repo, ctx.token);
  let rules: NotificationRule[];
  try {
    const manifest = await readNotificationsManifestFresh();
    rules = manifest.manifest.rules.filter(
      (r) => r.enabled && r.event === event,
    );
  } catch (err) {
    logger.warn(
      {
        event: "notifications_manifest_read_failed",
        kodyEvent: event,
        owner: ctx.owner,
        repo: ctx.repo,
        error: err instanceof Error ? err.message : String(err),
      },
      "Failed to read notifications manifest; skipping dispatch",
    );
    clearGitHubContext();
    return;
  } finally {
    // setGitHubContext is per-async-context but we clear eagerly to be safe.
    // The manifest read is the only call that needs auth here.
    clearGitHubContext();
  }

  if (rules.length === 0) {
    logger.info(
      { event: "notifications_no_rules", kodyEvent: event },
      "No matching notification rules — nothing to fire",
    );
    return;
  }

  await Promise.all(
    rules.map(async (rule) => {
      const template = rule.template ?? defaultTemplateForEvent(rule.event);
      const text = renderTemplate(template, payloadCtx);
      try {
        await sendNotification(rule.channel, {
          text,
          vars: payloadCtx,
          github: { owner: ctx.owner, repo: ctx.repo, token: ctx.token },
        });
        logger.info(
          {
            event: "notification_sent",
            ruleId: rule.id,
            channelType: rule.channel.type,
            kodyEvent: event,
          },
          `Notification sent (${rule.name} via ${rule.channel.type})`,
        );
      } catch (err) {
        logger.error(
          {
            event: "notification_send_failed",
            ruleId: rule.id,
            channelType: rule.channel.type,
            kodyEvent: event,
            error: err instanceof Error ? err.message : String(err),
          },
          `Notification failed (${rule.name} via ${rule.channel.type})`,
        );
      }
    }),
  );
}

/**
 * Top-level entry point for the webhook handler. Inspects the payload,
 * decides which event(s) it represents, and dispatches. Returns silently —
 * caller should not block on this.
 */
export async function dispatchNotifications(
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const ev = buildSourceEvent(eventType, payload);
  if (!ev || !ev.owner || !ev.repo) return;

  // App installation token (preferred) or vault GITHUB_TOKEN fallback. Never
  // a shared human PAT — webhooks fire constantly and would drain (and flag)
  // that account's budget, breaking every dashboard read.
  const bg = await resolveBackgroundToken(ev.owner, ev.repo);
  if (!bg) {
    logger.warn(
      { event: "notifications_no_token", repo: ev.repoFullName },
      "No App install or vault GITHUB_TOKEN for repo — cannot read notifications manifest",
    );
    return;
  }
  const token = bg.token;

  if (ev.eventType === "pull_request") {
    const merged = isDeployPrMerged(ev.action, ev.pr);
    if (merged.matched) {
      const prCtx = buildPrContext(ev.pr, {
        repoFullName: ev.repoFullName,
        version: merged.version,
      });
      await fireNotifications("deploy_pr_merged", prCtx, {
        owner: ev.owner,
        repo: ev.repo,
        token,
      });
    }
  }
  // Future: add task_completed, ci_failed, release_failed branches here.
}
