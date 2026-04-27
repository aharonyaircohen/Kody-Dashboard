/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern github-webhook
 *
 * POST /api/webhooks/github
 *
 * GitHub webhook receiver. Verifies HMAC-SHA256 signature against
 * KODY_WEBHOOK_SECRET, then invalidates the in-memory cache for the
 * affected resource so the next read picks up the change without waiting
 * for TTL.
 *
 * This is the foundation of the push-based architecture that replaces
 * polling. See CLAUDE.md > "GitHub API rate-limit rules".
 *
 * Subscribed events (configured at hook registration):
 *   issues, issue_comment, pull_request, pull_request_review,
 *   workflow_run, workflow_job, check_run, push
 *
 * Idempotency: GitHub may deliver the same event more than once. We dedupe
 * by X-GitHub-Delivery via an in-memory LRU. Cross-instance duplicate
 * delivery is harmless — invalidation is idempotent.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import {
  invalidateIssueCache,
  invalidatePRCache,
  invalidateBranchCache,
  invalidateWorkflowCache,
} from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";

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

// ============ HMAC verification ============

function verifySignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = "sha256=" +
    crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ============ Event dispatch ============

interface IssuesPayload {
  issue?: { number?: number };
}
interface IssueCommentPayload {
  issue?: { number?: number };
}
interface PullRequestPayload {
  pull_request?: { number?: number };
}

function dispatch(event: string, payload: unknown): { handled: boolean; detail: string } {
  switch (event) {
    case "ping":
      return { handled: true, detail: "ping" };

    case "issues":
    case "issue_comment": {
      const p = payload as IssuesPayload | IssueCommentPayload;
      const num = p?.issue?.number;
      invalidateIssueCache(typeof num === "number" ? num : undefined);
      return { handled: true, detail: `issue#${num ?? "?"}` };
    }

    case "pull_request":
    case "pull_request_review":
    case "pull_request_review_comment": {
      const p = payload as PullRequestPayload;
      invalidatePRCache();
      // PRs are also exposed as issues in the GitHub API; clear that too.
      invalidateIssueCache(p?.pull_request?.number);
      return { handled: true, detail: `pr#${p?.pull_request?.number ?? "?"}` };
    }

    case "workflow_run":
    case "workflow_job":
    case "check_run":
    case "check_suite":
      invalidateWorkflowCache();
      return { handled: true, detail: event };

    case "push":
    case "create":
    case "delete":
      invalidateBranchCache();
      return { handled: true, detail: event };

    default:
      return { handled: false, detail: event };
  }
}

// ============ Handler ============

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.KODY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    logger.error({ event: "webhook_not_configured" }, "KODY_WEBHOOK_SECRET missing");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifySignature(rawBody, signature, secret)) {
    logger.warn({ event: "webhook_bad_signature" }, "Webhook signature invalid");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const eventType = req.headers.get("x-github-event") ?? "";
  const deliveryId = req.headers.get("x-github-delivery") ?? "";

  if (deliveryId && rememberDelivery(deliveryId)) {
    return NextResponse.json({ ok: true, dedup: true }, { status: 200 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
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

  return NextResponse.json({ ok: true, handled: result.handled }, { status: 200 });
}
