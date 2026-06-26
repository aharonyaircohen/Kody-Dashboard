/**
 * @fileType api-endpoint
 * @domain capabilities
 * @pattern capabilities-api
 * @ai-summary Capability detail API — GET reads one, PATCH updates it,
 *   DELETE removes the capability folder. Backed by
 *   state-repo `capabilities/<slug>/{profile.json,capability.md}`.
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
  readCapabilityFile,
  readResolvedCapabilityFile,
  writeCapabilityFile,
  deleteCapabilityFile,
  isValidSlug,
  PERMISSION_MODES,
  CAPABILITY_KINDS,
} from "@dashboard/lib/capabilities";
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
    const capability = await readResolvedCapabilityFile(slug);
    if (!capability)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ capability, agentAction: capability });
  } catch (error: any) {
    console.error("[Capabilities] Error fetching capability:", error);
    return NextResponse.json(
      {
        error: "fetch_failed",
        message: error?.message ?? "Failed to fetch capability",
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

const updateCapabilitySchema = z.object({
  describe: z.string().optional(),
  capabilityKind: z.enum(CAPABILITY_KINDS).optional(),
  instructions: z.string().min(1).optional(),
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

    const input = updateCapabilitySchema.parse(await req.json());

    const actorResult = await verifyActorLogin(req, input.actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message:
            "A signed-in GitHub token is required to commit capability files.",
        },
        { status: 401 },
      );
    }

    const existing = await readCapabilityFile(slug, userOctokit);
    if (!existing)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    const instructions = input.instructions ?? input.prompt;

    const skills = input.skills ?? existing.skills;
    const shellScripts = input.shellScripts ?? existing.shellScripts;
    const removedSkills = existing.skills
      .map((s) => s.name)
      .filter((n) => !skills.some((s) => s.name === n));
    const removedShellScripts = existing.shellScripts
      .map((s) => s.name)
      .filter((n) => !shellScripts.some((s) => s.name === n));

    const capability = await writeCapabilityFile({
      octokit: userOctokit,
      fields: {
        slug,
        describe: input.describe ?? existing.describe,
        capabilityKind: input.capabilityKind ?? existing.capabilityKind,
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
      action: "capability.update",
      resource: slug,
      detail: `edited capability ${slug}`,
    });
    return NextResponse.json({ capability, agentAction: capability });
  } catch (error: any) {
    console.error("[Capabilities] Error updating capability:", error);
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
        message: error?.message ?? "Failed to update capability",
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
            "A signed-in GitHub token is required to delete capability files.",
        },
        { status: 401 },
      );
    }

    const existing = await readCapabilityFile(slug, userOctokit);
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
      const usesNewField = Array.isArray(config.company?.activeCapabilities);
      const activeCapabilities = usesNewField
        ? (config.company?.activeCapabilities ?? [])
        : (config.company?.activeAgentActions ?? []);
      if (!activeCapabilities.includes(slug)) {
        return NextResponse.json({ success: true, alreadyMissing: true });
      }

      const nextActiveCapabilities = activeCapabilities.filter(
        (value) => value !== slug,
      );
      await writeConfigPatch(
        userOctokit,
        headerAuth.owner,
        headerAuth.repo,
        usesNewField
          ? {
              activeCapabilities:
                nextActiveCapabilities.length > 0
                  ? nextActiveCapabilities
                  : null,
            }
          : {
              activeAgentActions:
                nextActiveCapabilities.length > 0
                  ? nextActiveCapabilities
                  : null,
            },
        `chore(kody): remove store capability ${slug}`,
      );

      recordAudit(req, {
        action: "capability.removeStoreReference",
        resource: slug,
        detail: `removed store capability reference ${slug}`,
      });
      return NextResponse.json({ success: true, removedStoreReference: true });
    }

    await deleteCapabilityFile(userOctokit, slug);
    recordAudit(req, {
      action: "capability.delete",
      resource: slug,
      detail: `deleted capability ${slug}`,
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Capabilities] Error deleting capability:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "delete_failed",
        message: error?.message ?? "Failed to delete capability",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
