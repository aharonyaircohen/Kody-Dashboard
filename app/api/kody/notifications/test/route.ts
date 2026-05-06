/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern notifications-test
 * @ai-summary POSTs a sample payload to a Slack webhook URL so the user can
 *   verify connectivity from the rule editor before saving. Server-side so
 *   the webhook URL never has to leave the dashboard's origin (avoids CORS
 *   and prevents leaking it via browser devtools).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireKodyAuth, verifyActorLogin } from "@dashboard/lib/auth";

const testSchema = z.object({
  url: z.string().url().startsWith("https://hooks.slack.com/"),
  text: z.string().min(1).max(2000),
  actorLogin: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const payload = await req.json();
    const parsed = testSchema.parse(payload);

    const actorResult = await verifyActorLogin(req, parsed.actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const res = await fetch(parsed.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: parsed.text }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        {
          error: "slack_post_failed",
          status: res.status,
          detail: detail.slice(0, 500),
        },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[Notifications/test] error:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: error.issues },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "test_failed", message: error?.message },
      { status: 500 },
    );
  }
}
