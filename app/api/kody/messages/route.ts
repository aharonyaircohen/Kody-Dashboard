/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern messages-channels-api
 * @ai-summary GET lists messaging channels (Discussions titled `#…` in the
 *   goals category). POST creates a new channel. When Discussions are off or
 *   no category exists, GET returns `{ enabled: false, reason, channels: [] }`
 *   so the UI can render the disabled badge instead of the channel list.
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
  fetchMessageChannels,
  createMessageChannel,
} from "@dashboard/lib/github-client";
import { ensureDiscussionsReady } from "@dashboard/lib/discussions-ready";

function mapGithubError(error: any, fallback: string, status = 500) {
  if (error?.status === 401) {
    return NextResponse.json({ error: "github_token_expired" }, { status: 401 });
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
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const userOctokit = await getUserOctokit(req);
    const ready = await ensureDiscussionsReady(userOctokit);
    if (!ready.ok) {
      return NextResponse.json(
        {
          enabled: false,
          reason: ready.reason,
          message: ready.message,
          channels: [],
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const channels = await fetchMessageChannels();
    return NextResponse.json(
      { enabled: true, channels },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    console.error("[Messages] GET error:", error);
    return mapGithubError(error, "channels_load_failed");
  } finally {
    clearGitHubContext();
  }
}

const createSchema = z.object({
  name: z.string().min(1).max(64),
  topic: z.string().max(2000).optional(),
  actorLogin: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const parsed = createSchema.parse(await req.json());

    const actorResult = await verifyActorLogin(req, parsed.actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }

    const ready = await ensureDiscussionsReady(userOctokit);
    if (!ready.ok) {
      return NextResponse.json(
        {
          error: "discussions_unavailable",
          reason: ready.reason,
          message: ready.message,
        },
        { status: 409 },
      );
    }

    const channel = await createMessageChannel(
      { name: parsed.name, categoryId: ready.categoryId, topic: parsed.topic },
      userOctokit,
    );
    return NextResponse.json({ channel });
  } catch (error: any) {
    console.error("[Messages] POST error:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: error.issues },
        { status: 400 },
      );
    }
    return mapGithubError(error, "channel_create_failed");
  } finally {
    clearGitHubContext();
  }
}
