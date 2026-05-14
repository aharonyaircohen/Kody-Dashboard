/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern notifications-api
 * @ai-summary Notifications API — GET lists rules from the manifest issue;
 *   POST creates a new rule (creating the manifest issue on first use).
 *   Mirrors the goals API pattern: writes go through
 *   `mutateNotificationsManifest` for per-repo CAS.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  verifyActorLogin,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import {
  fetchIssues,
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import {
  EMPTY_MANIFEST,
  NOTIFICATIONS_MANIFEST_LABEL,
  NOTIFICATION_EVENTS,
  parseManifestBody,
  slugifyRuleName,
  uniqueRuleId,
  type NotificationRule,
  type NotificationsManifest,
} from "@dashboard/lib/notifications";
import { mutateNotificationsManifest } from "@dashboard/lib/notifications-server";

function mapGithubError(error: any, fallback: string, status = 500) {
  if (error?.status === 401) {
    return NextResponse.json(
      { error: "github_token_expired" },
      { status: 401 },
    );
  }
  if (error?.status === 403 || error?.message?.includes("rate limit")) {
    return NextResponse.json(
      { error: "rate_limited", message: "GitHub API rate limit exceeded" },
      { status: 429 },
    );
  }
  return NextResponse.json(
    { error: fallback, message: error?.message ?? fallback },
    { status },
  );
}

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const issues = await fetchIssues({
      state: "open",
      labels: NOTIFICATIONS_MANIFEST_LABEL,
      perPage: 5,
      ttl: 15_000,
    });
    const sorted = [...issues].sort((a, b) => a.number - b.number);
    const issue = sorted[0];
    const manifest = issue
      ? parseManifestBody(issue.body ?? "")
      : { ...EMPTY_MANIFEST, rules: [] };
    return NextResponse.json(
      {
        rules: manifest.rules,
        manifest: { issueNumber: issue?.number ?? null },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    console.error("[Notifications] Error listing rules:", error);
    return mapGithubError(error, "list_failed");
  } finally {
    clearGitHubContext();
  }
}

// Discriminated union — one schema per channel type. The `type` field is the
// discriminator. Adding a new channel: add a variant here, in the [id] route,
// in `notifications.ts`, and create an adapter under `notifications/channels/`.
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
  z.object({
    type: z.literal("web-push"),
  }),
]);

const createRuleSchema = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean().optional().default(true),
  event: z.enum(NOTIFICATION_EVENTS),
  channel: channelSchema,
  template: z.string().max(2000).optional(),
  actorLogin: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const payload = await req.json();
    const parsed = createRuleSchema.parse(payload);

    const actorResult = await verifyActorLogin(req, parsed.actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);

    const outcome = await mutateNotificationsManifest<NotificationRule>(
      (current) => {
        const id = uniqueRuleId(slugifyRuleName(parsed.name), current.rules);
        const now = new Date().toISOString();
        const rule: NotificationRule = {
          id,
          name: parsed.name.trim(),
          enabled: parsed.enabled ?? true,
          event: parsed.event,
          channel: parsed.channel,
          template: parsed.template?.trim() || undefined,
          createdAt: now,
          updatedAt: now,
        };
        const next: NotificationsManifest = {
          version: 1,
          rules: [...current.rules, rule],
        };
        return { next, result: rule };
      },
      { userOctokit: userOctokit ?? undefined },
    );

    if ("kind" in outcome) {
      return NextResponse.json({ error: "create_failed" }, { status: 500 });
    }
    return NextResponse.json({ rule: outcome.result });
  } catch (error: any) {
    console.error("[Notifications] Error creating rule:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: error.issues },
        { status: 400 },
      );
    }
    return mapGithubError(error, "create_failed");
  } finally {
    clearGitHubContext();
  }
}
