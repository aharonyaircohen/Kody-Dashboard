/**
 * @fileType api-endpoint
 * @domain agentActions
 * @pattern agentActions-api
 * @ai-summary Set (or clear) this agentAction as the bare-`@kody` default.
 *   POST { target: "issue" | "pr", clear?: boolean } writes
 *   `defaultAgentAction` / `defaultPrAgentAction` in kody.config.json — the
 *   fields the engine reads when a comment is just `@kody` with no verb.
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
import { isValidSlug } from "@dashboard/lib/agent-actions";
import { writeDefaultAgentAction } from "@dashboard/lib/engine/config";
import { recordAudit } from "@dashboard/lib/activity/audit";

const bodySchema = z.object({
  target: z.enum(["issue", "pr"]),
  clear: z.boolean().default(false),
  actorLogin: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  try {
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }

    const { target, clear, actorLogin } = bodySchema.parse(await req.json());

    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message:
            "A signed-in GitHub token is required to edit kody.config.json.",
        },
        { status: 401 },
      );
    }

    await writeDefaultAgentAction(
      userOctokit,
      headerAuth.owner,
      headerAuth.repo,
      target,
      clear ? null : slug,
    );

    recordAudit(req, {
      action: "agentAction.set_default",
      resource: slug,
      detail: clear
        ? `cleared default ${target} agentAction`
        : `set ${slug} as default ${target} agentAction`,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[AgentActions] Error setting default:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: error.issues },
        { status: 400 },
      );
    }
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "set_default_failed",
        message: error?.message ?? "Failed to set default",
      },
      { status: 500 },
    );
  }
}
