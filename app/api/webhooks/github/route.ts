/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern github-webhook
 *
 * POST /api/webhooks/github
 *
 * GitHub webhook receiver. Verifies the source IP against GitHub's
 * published webhook CIDR ranges (https://api.github.com/meta) instead
 * of using a shared HMAC secret — no env var to manage. See
 * src/dashboard/lib/webhooks/github-ip.ts for rationale.
 *
 * On accepted delivery, invalidates the in-memory cache for the affected
 * resource so the next read picks up the change without waiting for TTL.
 *
 * This is the foundation of the push-based architecture that replaces
 * polling. See CLAUDE.md > "GitHub API rate-limit rules".
 *
 * Subscribed events (configured at hook registration):
 *   issues, issue_comment, pull_request, pull_request_review,
 *   workflow_run, workflow_job, check_run, push, release
 *
 * Idempotency: GitHub may deliver the same event more than once. We dedupe
 * by X-GitHub-Delivery via an in-memory LRU. Cross-instance duplicate
 * delivery is harmless — invalidation is idempotent.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  invalidateIssueCache,
  invalidatePRCache,
  invalidateBranchCache,
  invalidateWorkflowCache,
  invalidatePRBehindCache,
  invalidateDiscussionCache,
} from "@dashboard/lib/github-client";
import { getClientIp, isFromGitHub } from "@dashboard/lib/webhooks/github-ip";
import { logger } from "@dashboard/lib/logger";
import { dispatchNotifications } from "@dashboard/lib/notifications-dispatch";
import { dispatchMentionPushes } from "@dashboard/lib/push/mention-dispatch";
import { dispatchStaffMentions } from "@dashboard/lib/push/staff-mention-dispatch";
import { dispatchDutyFailures } from "@dashboard/lib/push/duty-failure-dispatch";
import { dispatchReportPushes } from "@dashboard/lib/push/report-dispatch";
import { applyVerdictFromComment } from "@dashboard/lib/ui-verify/apply-label";
import {
  handlePrMerged,
  handleReleasePublished,
} from "@dashboard/lib/changelog/handlers";
import { handlePrClosed as handlePreviewPrClosed } from "@dashboard/lib/previews/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============ Delivery dedupe (per-instance) ============

const SEEN_DELIVERIES_MAX = 512;
const seenDeliveries = new Set<string>();
const seenOrder: string[] = [];

function rememberDelivery(id: string): boolean {
  if (seenDeliveries.has(id)) return true;
  seenDeliveries.add(id);
  seenOrder.push(id);
  if (seenOrder.length > SEEN_DELIVERIES_MAX) {
    const evicted = seenOrder.shift();
    if (evicted) seenDeliveries.delete(evicted);
  }
  return false;
}

// ============ Event dispatch ============

interface IssuesPayload {
  issue?: { number?: number };
}
interface IssueCommentPayload {
  action?: string;
  issue?: { number?: number; pull_request?: unknown };
  comment?: { body?: string; user?: { login?: string } };
}
interface PullRequestPayload {
  action?: string;
  pull_request?: { number?: number; merged?: boolean };
  repository?: { full_name?: string };
}

interface ReleasePayload {
  action?: string;
  release?: { tag_name?: string };
}
/**
 * Best-effort side effect: never block the webhook response on it, and never
 * let a rejection crash the receiver. Errors are logged inside each handler.
 */
function fireAndForget(promise: Promise<unknown>, label: string): void {
  promise.catch((err: unknown) => {
    logger.error(
      {
        event: "ui_verify_handler_crashed",
        label,
        error: err instanceof Error ? err.message : String(err),
      },
      `${label} handler threw — should have been caught internally`,
    );
  });
}

function dispatch(
  event: string,
  payload: unknown,
): { handled: boolean; detail: string } {
  switch (event) {
    case "ping":
      return { handled: true, detail: "ping" };

    case "issues": {
      const p = payload as IssuesPayload;
      const num = p?.issue?.number;
      invalidateIssueCache(typeof num === "number" ? num : undefined);
      return { handled: true, detail: `issue#${num ?? "?"}` };
    }

    case "issue_comment": {
      const p = payload as IssueCommentPayload;
      const num = p?.issue?.number;
      invalidateIssueCache(typeof num === "number" ? num : undefined);

      // ui-verify side-effect: if this is a new comment on a PR (issues
      // with a `pull_request` field) and the body carries a ui-review
      // verdict marker, apply the verdict label. Idempotent — addLabels
      // is a no-op when the label is already present.
      const isPrComment = !!p?.issue?.pull_request;
      const isCreated = p?.action === "created";
      const body = p?.comment?.body ?? "";
      if (
        isPrComment &&
        isCreated &&
        typeof num === "number" &&
        body.includes("Verdict")
      ) {
        fireAndForget(
          applyVerdictFromComment(num, body),
          `applyVerdictFromComment#${num}`,
        );
      }

      return { handled: true, detail: `issue#${num ?? "?"}` };
    }

    case "pull_request":
    case "pull_request_review":
    case "pull_request_review_comment": {
      const p = payload as PullRequestPayload;
      invalidatePRCache();
      invalidatePRBehindCache();
      // PRs are also exposed as issues in the GitHub API; clear that too.
      invalidateIssueCache(p?.pull_request?.number);
      // On merge, append a bullet to CHANGELOG.md under `## [Unreleased]`.
      // Idempotent on PR number; fire-and-forget so a slow GitHub write
      // never blocks the webhook ACK.
      if (
        event === "pull_request" &&
        p?.action === "closed" &&
        p?.pull_request?.merged
      ) {
        fireAndForget(
          handlePrMerged(payload as Record<string, unknown>),
          `changelog.append#${p.pull_request.number ?? "?"}`,
        );
      }
      // Tear down per-PR preview when the PR closes (merged OR not).
      // No-op when the target repo isn't opted into previews (no
      // FLY_API_TOKEN in vault) — handler resolves the config itself.
      if (
        event === "pull_request" &&
        p?.action === "closed" &&
        typeof p?.pull_request?.number === "number" &&
        p?.repository?.full_name
      ) {
        fireAndForget(
          handlePreviewPrClosed({
            repoFullName: p.repository.full_name,
            prNumber: p.pull_request.number,
          }),
          `previews.destroy#${p.pull_request.number}`,
        );
      }
      return { handled: true, detail: `pr#${p?.pull_request?.number ?? "?"}` };
    }

    case "release": {
      const p = payload as ReleasePayload;
      if (p?.action === "published") {
        fireAndForget(
          handleReleasePublished(payload as Record<string, unknown>),
          `changelog.promote#${p.release?.tag_name ?? "?"}`,
        );
      }
      return {
        handled: true,
        detail: `release:${p?.release?.tag_name ?? "?"}`,
      };
    }

    case "check_run": {
      invalidateWorkflowCache();

      // ui-verify auto-dispatch is DISABLED. Previously, every successful
      // Vercel preview check auto-posted `@kody ui-review`. With auto-sync
      // re-pushing ~30 open PRs every cycle, each rebuild produced a fresh
      // preview-ready check, so this re-fired endlessly (984 comments
      // observed) and jammed the engine's Actions queue. The per-PR guard
      // label didn't hold because the SHA changes on every sync.
      //
      // UI review is now opt-in only: the explicit "Request UI review"
      // button in PreviewActions still posts `@kody ui-review` on demand.
      // Re-enabling auto-dispatch requires SHA/preview-URL-keyed dedup so
      // a rebuild of the same PR can't re-trigger it.

      return { handled: true, detail: event };
    }

    case "workflow_run":
    case "workflow_job":
    case "check_suite":
      invalidateWorkflowCache();
      return { handled: true, detail: event };

    case "push":
    case "create":
    case "delete":
      invalidateBranchCache();
      // A push to base branch makes every open PR potentially behind; clear
      // the per-PR behind-by cache so the Preview Sync button updates.
      invalidatePRBehindCache();
      return { handled: true, detail: event };

    case "discussion":
    case "discussion_comment":
      // New comment on a goal-backing discussion → wipe both the comment
      // cache and the meta cache (the discussion event payload doesn't carry
      // the discussion number, and the meta is cheap to refetch).
      invalidateDiscussionCache();
      return { handled: true, detail: event };

    case "repository":
      // Repo capabilities (Discussions toggled, categories renamed) may have
      // changed. Drop the cached meta so the next read re-checks GitHub.
      invalidateDiscussionCache();
      return { handled: true, detail: event };

    default:
      return { handled: false, detail: event };
  }
}

// ============ Handler ============

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req.headers);
  const allowed = await isFromGitHub(ip);
  if (!allowed) {
    logger.warn(
      { event: "webhook_unauthorized_ip", ip: ip ?? "(none)" },
      "Webhook rejected: source IP not in GitHub's hook CIDRs",
    );
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const eventType = req.headers.get("x-github-event") ?? "";
  const deliveryId = req.headers.get("x-github-delivery") ?? "";

  if (deliveryId && rememberDelivery(deliveryId)) {
    return NextResponse.json({ ok: true, dedup: true }, { status: 200 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const result = dispatch(eventType, payload);
  logger.info(
    {
      event: "webhook_received",
      type: eventType,
      delivery: deliveryId,
      handled: result.handled,
      detail: result.detail,
    },
    "GitHub webhook processed",
  );

  // Fire-and-forget Slack notifications. Errors are swallowed inside; we
  // never want a failed Slack POST to cause GitHub to retry the delivery.
  if (typeof payload === "object" && payload !== null) {
    const obj = payload as Record<string, unknown>;
    dispatchNotifications(eventType, obj).catch((err: unknown) => {
      logger.error(
        {
          event: "notifications_dispatch_crashed",
          error: err instanceof Error ? err.message : String(err),
        },
        "dispatchNotifications threw — should have been caught internally",
      );
    });
    // Push @mentions to the mentioned users' devices + record the inbox feed.
    // AWAIT it: on Vercel serverless, fire-and-forget work is killed once the
    // response is sent, so the (vault-token + manifest-write) save must finish
    // before we return or the inbox entry is silently lost.
    await dispatchMentionPushes(eventType, obj).catch((err: unknown) => {
      logger.error(
        {
          event: "mention_push_dispatch_crashed",
          error: err instanceof Error ? err.message : String(err),
        },
        "dispatchMentionPushes threw — should have been caught internally",
      );
    });
    // @staff mentions → one-shot worker-ask tick, reply back in-thread.
    // Same GitHub-backed surfaces as mention push (messages, goals, tasks,
    // previews, PR/issue comments, reviews) — one hook covers them all.
    await dispatchStaffMentions(eventType, obj).catch((err: unknown) => {
      logger.error(
        {
          event: "staff_mention_dispatch_crashed",
          error: err instanceof Error ? err.message : String(err),
        },
        "dispatchStaffMentions threw — should have been caught internally",
      );
    });
    // Failed duty run → inbox entry for every operator. Triggered by the
    // engine's activity-log commit to the state branch (a `push` event), so
    // a silent cron failure surfaces without any engine change. Awaited for
    // the same serverless reason as the mention feed write above.
    await dispatchDutyFailures(eventType, obj).catch((err: unknown) => {
      logger.error(
        {
          event: "duty_failure_dispatch_crashed",
          error: err instanceof Error ? err.message : String(err),
        },
        "dispatchDutyFailures threw — should have been caught internally",
      );
    });
    // New report committed to .kody/reports/<slug>.md on the default branch →
    // broadcast browser banner to every subscribed device for the repo, so a
    // report landing feels like an inbox/mention ping. Awaited for the same
    // serverless reason as the entries above.
    await dispatchReportPushes(eventType, obj).catch((err: unknown) => {
      logger.error(
        {
          event: "report_push_dispatch_crashed",
          error: err instanceof Error ? err.message : String(err),
        },
        "dispatchReportPushes threw — should have been caught internally",
      );
    });
  }

  return NextResponse.json(
    { ok: true, handled: result.handled },
    { status: 200 },
  );
}
