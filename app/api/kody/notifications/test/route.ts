/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern notifications-test
 * @ai-summary POST a sample message via the channel's adapter so the user can
 *   verify connectivity from the rule editor before saving. Server-side so
 *   secrets (Slack URLs, Telegram bot tokens, Discord URLs, custom webhook
 *   headers) never have to leave the dashboard's origin (avoids CORS and
 *   prevents leaking via browser devtools).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireKodyAuth, verifyActorLogin } from "@dashboard/lib/auth";
import { sendNotification } from "@dashboard/lib/notifications/channels";

const channelSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("slack-webhook"),
    url: z.string().url().startsWith("https://hooks.slack.com/"),
  }),
  z.object({
    type: z.literal("telegram-bot"),
    botToken: z.string().min(1),
    chatId: z.string().min(1),
  }),
  z.object({
    type: z.literal("discord-webhook"),
    url: z
      .string()
      .url()
      .regex(/^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\//),
  }),
  z.object({
    type: z.literal("generic-webhook"),
    url: z.string().url().startsWith("https://"),
    jsonTemplate: z.string().max(4000).optional(),
    bodyFormat: z.enum(["json", "form"]).optional(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
]);

const testSchema = z.object({
  channel: channelSchema,
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

    try {
      await sendNotification(parsed.channel, {
        text: parsed.text,
        vars: { repo: "test", prUrl: "", prTitle: "", prBody: "", author: "", version: "" },
      });
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      return NextResponse.json(
        {
          error: "send_failed",
          channelType: parsed.channel.type,
          detail: err?.message ?? String(err),
        },
        { status: 502 },
      );
    }
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
