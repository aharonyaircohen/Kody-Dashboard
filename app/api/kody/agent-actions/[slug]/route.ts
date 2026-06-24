/**
 * @fileType api-endpoint
 * @domain agentActions
 * @pattern agentActions-api
 * @ai-summary AgentAction detail API — GET reads one, PATCH updates it
 *   (re-generating profile.json + prompt.md and syncing skill/shell files,
 *   deleting any the editor removed), DELETE removes the whole folder.
 *   Backed by `.kody/agent-actions/<slug>/` via the Git Data API.
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
  readAgentActionFile,
  readResolvedAgentActionFile,
  writeAgentActionFile,
  deleteAgentActionFile,
  isValidSlug,
  PERMISSION_MODES,
} from "@dashboard/lib/agent-actions";
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
    const agentAction = await readResolvedAgentActionFile(slug);
    if (!agentAction)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ agentAction });
  } catch (error: any) {
    console.error("[AgentActions] Error fetching agentAction:", error);
    return NextResponse.json(
      {
        error: "fetch_failed",
        message: error?.message ?? "Failed to fetch agentAction",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

const skillSchema = z.object({
  name: z.string().min(1).max(64),
  body: z.string().default(""),
});
const shellSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9._-]+\.sh$/, "must be a *.sh filename"),
  content: z.string().default(""),
});
const mcpServerSchema = z.object({
  name: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/, "letters, digits, dash, underscore"),
  command: z.string().min(1, "command is required"),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const updateAgentActionSchema = z.object({
  describe: z.string().optional(),
  instructions: z.string().min(1).optional(),
  // Backward-compatible alias for older dashboard builds/API callers. The
  // authored concept is instructions; the engine storage file is prompt.md.
  prompt: z.string().min(1).optional(),
  model: z.string().optional(),
  permissionMode: z.enum(PERMISSION_MODES).optional(),
  tools: z.array(z.string()).optional(),
  skills: z.array(skillSchema).optional(),
  shellScripts: z.array(shellSchema).optional(),
  mcpServers: z.array(mcpServerSchema).optional(),
  landing: z.enum(["pr", "comment"]).optional(),
  profileJsonOverride: z.string().optional(),
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

    const input = updateAgentActionSchema.parse(await req.json());

    const actorResult = await verifyActorLogin(req, input.actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message:
            "A signed-in GitHub token is required to commit agentAction files.",
        },
        { status: 401 },
      );
    }

    const existing = await readAgentActionFile(slug, userOctokit);
    if (!existing)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    const instructions = input.instructions ?? input.prompt;

    const skills = input.skills ?? existing.skills;
    const shellScripts = input.shellScripts ?? existing.shellScripts;
    // Delete files the editor dropped (present before, absent now).
    const removedSkills = existing.skills
      .map((s) => s.name)
      .filter((n) => !skills.some((s) => s.name === n));
    const removedShellScripts = existing.shellScripts
      .map((s) => s.name)
      .filter((n) => !shellScripts.some((s) => s.name === n));

    const agentAction = await writeAgentActionFile({
      octokit: userOctokit,
      fields: {
        slug,
        describe: input.describe ?? existing.describe,
        prompt: instructions ?? existing.prompt,
        model: input.model ?? existing.model,
        permissionMode: input.permissionMode ?? existing.permissionMode,
        tools: input.tools ?? existing.tools,
        skills: skills.map((s) => s.name),
        shellScripts: shellScripts.map((s) => s.name),
        mcpServers: input.mcpServers ?? existing.mcpServers,
        landing: input.landing ?? existing.landing,
      },
      skills,
      shellScripts,
      profileJsonOverride: input.profileJsonOverride,
      removedSkills,
      removedShellScripts,
      isUpdate: true,
    });

    recordAudit(req, {
      action: "agentAction.update",
      resource: slug,
      detail: `edited agentAction ${slug}`,
    });
    return NextResponse.json({ agentAction });
  } catch (error: any) {
    console.error("[AgentActions] Error updating agentAction:", error);
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
        message: error?.message ?? "Failed to update agentAction",
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
            "A signed-in GitHub token is required to delete agentAction files.",
        },
        { status: 401 },
      );
    }

    const existing = await readAgentActionFile(slug, userOctokit);
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
      const activeAgentActions = config.company?.activeAgentActions ?? [];
      if (!activeAgentActions.includes(slug)) {
        return NextResponse.json({ success: true, alreadyMissing: true });
      }

      const nextActiveAgentActions = activeAgentActions.filter(
        (value) => value !== slug,
      );
      await writeConfigPatch(
        userOctokit,
        headerAuth.owner,
        headerAuth.repo,
        {
          activeAgentActions:
            nextActiveAgentActions.length > 0 ? nextActiveAgentActions : null,
        },
        `chore(kody): remove store agentAction ${slug}`,
      );

      recordAudit(req, {
        action: "agentAction.removeStoreReference",
        resource: slug,
        detail: `removed store agentAction reference ${slug}`,
      });
      return NextResponse.json({ success: true, removedStoreReference: true });
    }

    await deleteAgentActionFile(userOctokit, slug);
    recordAudit(req, {
      action: "agentAction.delete",
      resource: slug,
      detail: `deleted agentAction ${slug}`,
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[AgentActions] Error deleting agentAction:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "delete_failed",
        message: error?.message ?? "Failed to delete agentAction",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
