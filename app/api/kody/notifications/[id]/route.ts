/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern notifications-api
 * @ai-summary Single rule API — PATCH updates fields, DELETE removes the rule.
 *   Both go through `mutateNotificationsManifest` for CAS.
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
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import {
  NOTIFICATION_EVENTS,
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
    headers: z.record(z.string(), z.string()).optional(),
  }),
]);

const patchRuleSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  event: z.enum(NOTIFICATION_EVENTS).optional(),
  channel: channelSchema.optional(),
  template: z.string().max(2000).nullable().optional(),
  actorLogin: z.string().optional(),
});

type PatchOutcome =
  | { ok: true; rule: NotificationRule }
  | { ok: false; reason: "not_found" };

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const { id } = await params;
    const payload = await req.json();
    const patch = patchRuleSchema.parse(payload);

    const actorResult = await verifyActorLogin(req, patch.actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);

    const outcome = await mutateNotificationsManifest<PatchOutcome>(
      (current) => {
        const index = current.rules.findIndex((r) => r.id === id);
        if (index === -1) {
          return {
            kind: "noop" as const,
            result: { ok: false, reason: "not_found" } as const,
          };
        }
        const cur = current.rules[index];
        const updated: NotificationRule = {
          ...cur,
          name: patch.name?.trim() ?? cur.name,
          enabled: patch.enabled ?? cur.enabled,
          event: patch.event ?? cur.event,
          channel: patch.channel ?? cur.channel,
          template:
            patch.template === null
              ? undefined
              : patch.template === undefined
                ? cur.template
                : patch.template.trim() || undefined,
          updatedAt: new Date().toISOString(),
        };
        const nextRules = [...current.rules];
        nextRules[index] = updated;
        const next: NotificationsManifest = { version: 1, rules: nextRules };
        return { next, result: { ok: true, rule: updated } };
      },
      { userOctokit: userOctokit ?? undefined },
    );

    const result =
      "kind" in outcome ? outcome.result : (outcome.result as PatchOutcome);
    if (!result.ok) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ rule: result.rule });
  } catch (error: any) {
    console.error("[Notifications] Error updating rule:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: error.issues },
        { status: 400 },
      );
    }
    return mapGithubError(error, "update_failed");
  } finally {
    clearGitHubContext();
  }
}

const deleteSchema = z.object({ actorLogin: z.string().optional() });

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const { id } = await params;
    const url = new URL(req.url);
    const actorLogin = url.searchParams.get("actorLogin") ?? undefined;
    deleteSchema.parse({ actorLogin });

    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);

    const outcome = await mutateNotificationsManifest<{ ok: boolean }>(
      (current) => {
        const exists = current.rules.some((r) => r.id === id);
        if (!exists) {
          return { kind: "noop" as const, result: { ok: false } };
        }
        const nextRules = current.rules.filter((r) => r.id !== id);
        return {
          next: { version: 1, rules: nextRules },
          result: { ok: true },
        };
      },
      { userOctokit: userOctokit ?? undefined },
    );

    const result = outcome.result;
    if (!result.ok) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[Notifications] Error deleting rule:", error);
    return mapGithubError(error, "delete_failed");
  } finally {
    clearGitHubContext();
  }
}
