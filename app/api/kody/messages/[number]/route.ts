/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern messages-thread-api
 * @ai-summary GET returns a channel's metadata + comment feed. POST posts a
 *   message to the channel. Channel identity comes from `fetchMessageChannels`
 *   (cached); the feed reuses `fetchGoalDiscussionComments` /
 *   `postGoalDiscussionComment`, so posting invalidates the correct per-
 *   discussion comment cache and @mentions fan out to push/Slack/inbox via
 *   the existing `discussion_comment` webhook path.
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
  fetchGoalDiscussionComments,
  postGoalDiscussionComment,
  deleteMessageChannel,
} from "@dashboard/lib/github-client";

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

function parseNumber(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ number: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const channelNumber = parseNumber((await params).number);
    if (channelNumber === null) {
      return NextResponse.json({ error: "invalid_channel" }, { status: 400 });
    }

    const channels = await fetchMessageChannels();
    const channel = channels.find((c) => c.number === channelNumber);
    if (!channel) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const comments = await fetchGoalDiscussionComments(channelNumber);
    return NextResponse.json(
      {
        channel: {
          number: channel.number,
          id: channel.id,
          name: channel.name,
          url: channel.url,
        },
        comments,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    console.error("[Messages] thread GET error:", error);
    return mapGithubError(error, "thread_load_failed");
  } finally {
    clearGitHubContext();
  }
}

const postSchema = z.object({
  body: z.string().min(1).max(65000),
  actorLogin: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ number: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const channelNumber = parseNumber((await params).number);
    if (channelNumber === null) {
      return NextResponse.json({ error: "invalid_channel" }, { status: 400 });
    }

    const parsed = postSchema.parse(await req.json());

    const actorResult = await verifyActorLogin(req, parsed.actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }

    const channels = await fetchMessageChannels();
    const channel = channels.find((c) => c.number === channelNumber);
    if (!channel) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const comment = await postGoalDiscussionComment(
      {
        discussionId: channel.id,
        body: parsed.body,
        discussionNumber: channel.number,
      },
      userOctokit,
    );
    return NextResponse.json({ comment });
  } catch (error: any) {
    console.error("[Messages] thread POST error:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: error.issues },
        { status: 400 },
      );
    }
    return mapGithubError(error, "message_post_failed");
  } finally {
    clearGitHubContext();
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ number: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const channelNumber = parseNumber((await params).number);
    if (channelNumber === null) {
      return NextResponse.json({ error: "invalid_channel" }, { status: 400 });
    }

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }

    const channels = await fetchMessageChannels();
    const channel = channels.find((c) => c.number === channelNumber);
    if (!channel) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    await deleteMessageChannel(channel.id, userOctokit);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[Messages] thread DELETE error:", error);
    return mapGithubError(error, "channel_delete_failed");
  } finally {
    clearGitHubContext();
  }
}
