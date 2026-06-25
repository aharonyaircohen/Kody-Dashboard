/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern agent-api
 * @ai-summary Agent detail API — GET reads a single agent file, PATCH
 *   updates the title/body, DELETE removes the file. Backed by
 *   `agents/<slug>.md` in the state repo. Duplicated
 *   from the agentResponsibilities detail API.
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
  readAgentFile,
  readResolvedAgentFile,
  writeAgentFile,
  deleteAgentFile,
  isValidSlug,
} from "@dashboard/lib/agent-files";
import {
  getEngineConfig,
  writeConfigPatch,
} from "@dashboard/lib/engine/config";
import { recordAudit } from "@dashboard/lib/activity/audit";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(
      headerAuth.owner,
      headerAuth.repo,
      headerAuth.token,
      headerAuth.storeRepoUrl,
      headerAuth.storeRef,
    );

  try {
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }
    const agentMember = await readResolvedAgentFile(slug);
    if (!agentMember) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ agentMember });
  } catch (error: any) {
    console.error("[Agent] Error fetching agent:", error);
    return NextResponse.json(
      {
        error: "fetch_failed",
        message: error?.message ?? "Failed to fetch agent",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

const updateAgentSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  actorLogin: z.string().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(
      headerAuth.owner,
      headerAuth.repo,
      headerAuth.token,
      headerAuth.storeRepoUrl,
      headerAuth.storeRef,
    );

  try {
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }

    const existing = await readAgentFile(slug);
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const payload = await req.json();
    const { title, body, actorLogin } = updateAgentSchema.parse(payload);

    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message:
            "A signed-in GitHub token is required to commit agent files.",
        },
        { status: 401 },
      );
    }

    const agentMember = await writeAgentFile({
      octokit: userOctokit,
      slug,
      title: title ?? existing.title,
      body: body ?? existing.body,
      sha: existing.sha,
    });

    recordAudit(req, {
      action: "agent.update",
      resource: slug,
      agent: slug,
      detail: "edited agent",
    });

    return NextResponse.json({ agentMember });
  } catch (error: any) {
    console.error("[Agent] Error updating agent:", error);

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
        message: error?.message ?? "Failed to update agent",
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
    setGitHubContext(
      headerAuth.owner,
      headerAuth.repo,
      headerAuth.token,
      headerAuth.storeRepoUrl,
      headerAuth.storeRef,
    );

  try {
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }

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
            "A signed-in GitHub token is required to delete agent files.",
        },
        { status: 401 },
      );
    }

    const existing = await readAgentFile(slug, userOctokit);
    if (!existing) {
      if (!headerAuth) {
        return NextResponse.json({ success: true, alreadyMissing: true });
      }

      const { config } = await getEngineConfig(
        userOctokit,
        headerAuth.owner,
        headerAuth.repo,
        { force: true },
      );
      const activeAgents = config.company?.activeAgents ?? [];
      if (!activeAgents.includes(slug)) {
        return NextResponse.json({ success: true, alreadyMissing: true });
      }

      const nextActiveAgents = activeAgents.filter((value) => value !== slug);
      await writeConfigPatch(
        userOctokit,
        headerAuth.owner,
        headerAuth.repo,
        {
          activeAgents: nextActiveAgents.length > 0 ? nextActiveAgents : null,
        },
        `chore(kody): remove store agent ${slug}`,
      );

      recordAudit(req, {
        action: "agent.removeStoreReference",
        resource: slug,
        agent: slug,
        detail: "removed store agent reference",
      });
      return NextResponse.json({ success: true, removedStoreReference: true });
    }

    await deleteAgentFile(userOctokit, slug);

    recordAudit(req, {
      action: "agent.delete",
      resource: slug,
      agent: slug,
      detail: "deleted agent",
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Agent] Error deleting agent:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "delete_failed",
        message: error?.message ?? "Failed to delete agent",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
