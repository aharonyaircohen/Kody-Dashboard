/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern push-subscribe
 * @ai-summary Push subscription endpoint. POST registers a device for push
 *   notifications on the current repo; DELETE removes one. Subscriptions
 *   live in the per-repo `kody:push-subscriptions` manifest issue and are
 *   keyed by endpoint URL (unique per browser+device per origin).
 *
 *   POST is idempotent — re-subscribing the same endpoint refreshes its
 *   keys + lastSeenAt without creating a duplicate row.
 *
 *   Auth: same `requireKodyAuth` + `getRequestAuth` plumbing as the rest of
 *   the dashboard. The user's PAT is what writes the manifest issue.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  getRequestAuth,
  getUserOctokit,
} from "@dashboard/lib/auth";
import {
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import { mutatePushManifest, readPushManifest } from "@dashboard/lib/push-server";
import type { PushSubscriptionRecord } from "@dashboard/lib/push";

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  label: z.string().max(120).optional(),
  userLogin: z.string().max(120).optional(),
});

function applyAuth(req: NextRequest): { ok: true } | NextResponse {
  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json(
      { error: "auth_required", message: "Missing repo auth headers" },
      { status: 401 },
    );
  }
  setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  return { ok: true };
}

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const ctx = applyAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { manifest } = await readPushManifest();
    return NextResponse.json(
      {
        subscriptions: manifest.subscriptions.map((s) => ({
          endpoint: s.endpoint,
          label: s.label,
          userLogin: s.userLogin,
          createdAt: s.createdAt,
          lastSeenAt: s.lastSeenAt,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: "list_failed", message: error?.message ?? "list failed" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const ctx = applyAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const payload = await req.json();
    const parsed = subscribeSchema.parse(payload);
    const userOctokit = await getUserOctokit(req);

    // Resolve the GitHub login from the PAT itself — clients can't be trusted
    // to send their own login, and we need it for @mention-targeted pushes.
    // Best-effort: if the lookup fails we keep whatever the client supplied
    // (or existing value) rather than blocking the subscribe.
    let resolvedLogin: string | undefined;
    if (userOctokit) {
      try {
        const { data } = await userOctokit.users.getAuthenticated();
        if (typeof data?.login === "string" && data.login.length > 0) {
          resolvedLogin = data.login;
        }
      } catch {
        // ignore — fall back below
      }
    }

    const outcome = await mutatePushManifest<PushSubscriptionRecord>(
      (current) => {
        const now = new Date().toISOString();
        const existing = current.subscriptions.find(
          (s) => s.endpoint === parsed.endpoint,
        );

        const updated: PushSubscriptionRecord = {
          endpoint: parsed.endpoint,
          keys: { p256dh: parsed.keys.p256dh, auth: parsed.keys.auth },
          label: parsed.label?.trim() || existing?.label,
          userLogin:
            resolvedLogin ?? parsed.userLogin?.trim() ?? existing?.userLogin,
          createdAt: existing?.createdAt ?? now,
          lastSeenAt: now,
        };

        // No-op if everything matches (same endpoint, same keys, same label).
        if (
          existing &&
          existing.keys.p256dh === updated.keys.p256dh &&
          existing.keys.auth === updated.keys.auth &&
          (existing.label ?? null) === (updated.label ?? null) &&
          (existing.userLogin ?? null) === (updated.userLogin ?? null)
        ) {
          return { kind: "noop" as const, result: existing };
        }

        const next = existing
          ? {
              version: 1 as const,
              subscriptions: current.subscriptions.map((s) =>
                s.endpoint === parsed.endpoint ? updated : s,
              ),
            }
          : {
              version: 1 as const,
              subscriptions: [...current.subscriptions, updated],
            };

        return { next, result: updated };
      },
      { userOctokit: userOctokit ?? undefined },
    );

    return NextResponse.json({ subscription: outcome.result });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: error.issues },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "subscribe_failed", message: error?.message ?? "subscribe failed" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

export async function DELETE(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const ctx = applyAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const payload = await req.json();
    const parsed = unsubscribeSchema.parse(payload);
    const userOctokit = await getUserOctokit(req);

    const outcome = await mutatePushManifest<boolean>(
      (current) => {
        const before = current.subscriptions.length;
        const next = {
          version: 1 as const,
          subscriptions: current.subscriptions.filter(
            (s) => s.endpoint !== parsed.endpoint,
          ),
        };
        if (next.subscriptions.length === before) {
          return { kind: "noop" as const, result: false };
        }
        return { next, result: true };
      },
      { userOctokit: userOctokit ?? undefined },
    );

    const removed = "kind" in outcome ? outcome.result : outcome.result;
    return NextResponse.json({ removed });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: error.issues },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "unsubscribe_failed", message: error?.message ?? "unsubscribe failed" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
