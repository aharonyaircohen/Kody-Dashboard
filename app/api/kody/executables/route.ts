/**
 * @fileType api-endpoint
 * @domain executables
 * @pattern executables-api
 * @ai-summary Executables Control API — GET lists custom executables stored
 *   at `.kody/executables/<slug>/` (merged with the bare-`@kody` default
 *   flags from kody.config.json), POST creates a new one. Each executable is
 *   a folder the engine resolves before its own built-ins.
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
  listExecutableFiles,
  listMarkdownDutySummaries,
  readExecutableFile,
  writeExecutableFile,
  isValidSlug,
  PERMISSION_MODES,
} from "@dashboard/lib/executables";
import { getEngineConfig } from "@dashboard/lib/engine/config";
import { recordAudit } from "@dashboard/lib/activity/audit";

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    // One unified duty list: folder-duties + legacy markdown duties merged so an
    // unmigrated repo's `.md` duties still show (folder wins on slug clash).
    // listMarkdownDutySummaries is a single dir listing — no per-duty reads.
    const [folderDuties, markdownDuties] = await Promise.all([
      listExecutableFiles(),
      listMarkdownDutySummaries().catch(() => []),
    ]);
    const folderSlugs = new Set(folderDuties.map((d) => d.slug));
    const executables = [
      ...folderDuties,
      ...markdownDuties.filter((d) => !folderSlugs.has(d.slug)),
    ].sort((a, b) => a.slug.localeCompare(b.slug));
    let defaults = { issue: null as string | null, pr: null as string | null };
    if (headerAuth) {
      const userOctokit = await getUserOctokit(req);
      if (userOctokit) {
        const { config } = await getEngineConfig(
          userOctokit,
          headerAuth.owner,
          headerAuth.repo,
        );
        defaults = {
          issue: config.defaultExecutable ?? null,
          pr: config.defaultPrExecutable ?? null,
        };
      }
    }
    return NextResponse.json({ executables, defaults });
  } catch (error: any) {
    console.error("[Executables] Error listing executables:", error);
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
      {
        executables: [],
        error: error?.message || "Failed to list executables",
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

const createExecutableSchema = z.object({
  slug: z.string().min(1).max(64),
  describe: z.string().default(""),
  prompt: z.string().min(1, "prompt is required"),
  model: z.string().default("inherit"),
  permissionMode: z.enum(PERMISSION_MODES).default("acceptEdits"),
  tools: z.array(z.string()).default([]),
  skills: z.array(skillSchema).default([]),
  shellScripts: z.array(shellSchema).default([]),
  mcpServers: z.array(mcpServerSchema).default([]),
  landing: z.enum(["pr", "comment"]).default("pr"),
  profileJsonOverride: z.string().optional(),
  actorLogin: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const payload = await req.json();
    const input = createExecutableSchema.parse(payload);

    if (!isValidSlug(input.slug)) {
      return NextResponse.json(
        {
          error: "invalid_slug",
          message:
            "Executable slug must be lowercase letters, digits, dashes, or underscores.",
        },
        { status: 400 },
      );
    }

    const existing = await readExecutableFile(input.slug);
    if (existing) {
      return NextResponse.json(
        {
          error: "slug_taken",
          message: `Executable "${input.slug}" already exists.`,
        },
        { status: 409 },
      );
    }

    const actorResult = await verifyActorLogin(req, input.actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message:
            "A signed-in GitHub token is required to commit executable files.",
        },
        { status: 401 },
      );
    }

    const executable = await writeExecutableFile({
      octokit: userOctokit,
      fields: {
        slug: input.slug,
        describe: input.describe,
        prompt: input.prompt,
        model: input.model,
        permissionMode: input.permissionMode,
        tools: input.tools,
        skills: input.skills.map((s) => s.name),
        shellScripts: input.shellScripts.map((s) => s.name),
        mcpServers: input.mcpServers,
        landing: input.landing,
      },
      skills: input.skills,
      shellScripts: input.shellScripts,
      profileJsonOverride: input.profileJsonOverride,
    });

    recordAudit(req, {
      action: "executable.create",
      resource: input.slug,
      detail: `created executable ${input.slug}`,
    });

    return NextResponse.json({ executable });
  } catch (error: any) {
    console.error("[Executables] Error creating executable:", error);
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
        error: "create_failed",
        message: error?.message ?? "Failed to create executable",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
