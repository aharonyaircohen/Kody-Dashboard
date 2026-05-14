/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern push-test-single-device
 * @ai-summary POST sends one push notification to a single endpoint — the
 *   device that requested the test. Used by the dashboard's "Send test push"
 *   button so users can verify end-to-end delivery without going through
 *   the full rule/manifest path.
 *
 *   Auth: same dashboard repo-auth (`x-kody-token / -owner / -repo`). The
 *   manifest is consulted to verify the endpoint is actually registered
 *   for the calling repo — otherwise anyone with the dashboard's repo
 *   token could send pushes to arbitrary endpoints.
 */
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import webpush from "web-push";
import {
  requireKodyAuth,
  getRequestAuth,
} from "@dashboard/lib/auth";
import {
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import { readPushManifest } from "@dashboard/lib/push-server";
import { deriveVapidKeys } from "@dashboard/lib/push/vapid-keys";

const testSchema = z.object({
  endpoint: z.string().url(),
});

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json(
      { error: "auth_required" },
      { status: 401 },
    );
  }
  setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const payload = await req.json();
    const parsed = testSchema.parse(payload);

    // Verify the endpoint is in this repo's manifest before sending. Without
    // this gate, the repo-auth token would also be a write-to-arbitrary-
    // endpoint primitive — small surface but trivial to close.
    const { manifest } = await readPushManifest();
    const sub = manifest.subscriptions.find((s) => s.endpoint === parsed.endpoint);
    if (!sub) {
      return NextResponse.json(
        { error: "endpoint_not_registered" },
        { status: 404 },
      );
    }

    const { publicKey, privateKey } = deriveVapidKeys();
    webpush.setVapidDetails("mailto:kody@example.com", publicKey, privateKey);

    const ts = new Date().toLocaleTimeString();
    const body = JSON.stringify({
      title: "Kody test push",
      body: `If you can read this, end-to-end delivery works. ${ts}`,
      url: "/notifications",
      tag: `kody-test-${Date.now()}`,
    });

    const result = await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      },
      body,
    );

    return NextResponse.json({
      ok: true,
      statusCode: result.statusCode,
    });
  } catch (err: unknown) {
    const error = err as { statusCode?: number; message?: string };
    return NextResponse.json(
      {
        error: "test_send_failed",
        statusCode: error.statusCode,
        message: error.message ?? String(err),
      },
      { status: 502 },
    );
  } finally {
    clearGitHubContext();
  }
}
