/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern context-api
 * @ai-summary Context entry detail API — GET reads a single entry, PATCH
 *   updates its body/agents, DELETE removes it. Backed by
 *   `context/<slug>.md` in the state repo. No built-ins, so a
 *   missing file is a plain 404.
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
  readContextFile,
  writeContextFile,
  deleteContextFile,
  isValidSlug,
} from "@dashboard/lib/context/files";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }
    const entry = await readContextFile(slug);
    if (!entry)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ entry });
  } catch (error: any) {
    console.error("[Context] Error fetching context entry:", error);
    return NextResponse.json(
      {
        error: "fetch_failed",
        message: error?.message ?? "Failed to fetch context entry",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

/** An agent slug (entry slug shape) or the `*` all-agent wildcard. */
const AGENT_TOKEN_RE = /^(\*|[a-z0-9][a-z0-9_-]{0,63})$/;

const updateContextSchema = z
  .object({
    body: z.string().min(1).optional(),
    // May be empty — an unassigned entry owned by no agent.
    agent: z.array(z.string().regex(AGENT_TOKEN_RE)).optional(),
    actorLogin: z.string().optional(),
  })
  .refine((v) => v.body !== undefined || v.agent !== undefined, {
    message: "At least one of `body` or `agent` must be provided.",
  });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }

    const payload = await req.json();
    const { body, agent, actorLogin } = updateContextSchema.parse(payload);

    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const existing = await readContextFile(slug);
    if (!existing)
      return NextResponse.json({ error: "not_found" }, { status: 404 });

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message:
            "A signed-in GitHub token is required to commit context files.",
        },
        { status: 401 },
      );
    }

    // Partial update: keep whichever field the caller omitted. `body` and
    // `agent` are independent — changing the agent list alone leaves the
    // text intact.
    const entry = await writeContextFile({
      octokit: userOctokit,
      slug,
      body: body ?? existing.body,
      agent: agent ?? existing.agent,
      sha: existing.sha,
    });
    return NextResponse.json({ entry });
  } catch (error: any) {
    console.error("[Context] Error updating context entry:", error);
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
        error: "update_failed",
        message: error?.message ?? "Failed to update context entry",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }

    const existing = await readContextFile(slug);
    if (!existing)
      return NextResponse.json({ error: "not_found" }, { status: 404 });

    const { searchParams } = new URL(req.url);
    const actorLogin = searchParams.get("actorLogin") ?? undefined;
    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message:
            "A signed-in GitHub token is required to delete context files.",
        },
        { status: 401 },
      );
    }

    await deleteContextFile(userOctokit, slug);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Context] Error deleting context entry:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "delete_failed",
        message: error?.message ?? "Failed to delete context entry",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
