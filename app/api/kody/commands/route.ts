/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern commands-api
 * @ai-summary Command Control API — GET lists repo commands, activated Store
 * commands, and fallback built-ins; POST creates a new repo command.
 *   Slash commands in the chat input are populated from this endpoint.
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
  listCommands,
  readCommandFile,
  writeCommandFile,
  isValidSlug,
} from "@dashboard/lib/commands";
import { recordAudit } from "@dashboard/lib/activity/audit";
import { getEngineConfig } from "@dashboard/lib/engine/config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: NextRequest) {
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
    const activeCommands = new Set<string>();
    const octokit = await getUserOctokit(req);
    if (octokit && headerAuth) {
      const { config } = await getEngineConfig(
        octokit,
        headerAuth.owner,
        headerAuth.repo,
      );
      for (const slug of config.company?.activeCommands ?? []) {
        activeCommands.add(slug);
      }
    }

    const commands = await listCommands({ activeStoreSlugs: activeCommands });
    return NextResponse.json({ commands }, { headers: NO_STORE_HEADERS });
  } catch (error: any) {
    console.error("[Commands] Error listing commands:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }
    if (error?.status === 403 || error?.message?.includes("rate limit")) {
      return NextResponse.json(
        { error: "rate_limited", message: "GitHub API rate limit exceeded" },
        { status: 429, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { commands: [], error: error?.message || "Failed to list commands" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  } finally {
    clearGitHubContext();
  }
}

const createCommandSchema = z.object({
  slug: z.string().min(1).max(64),
  description: z.string().default(""),
  argumentHint: z.string().optional(),
  body: z.string().min(1),
  actorLogin: z.string().optional(),
});

export async function POST(req: NextRequest) {
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
    const payload = await req.json();
    const { slug, description, argumentHint, body, actorLogin } =
      createCommandSchema.parse(payload);

    if (!isValidSlug(slug)) {
      return NextResponse.json(
        {
          error: "invalid_slug",
          message:
            "Command slug must be lowercase letters, digits, dashes, or underscores.",
        },
        { status: 400 },
      );
    }

    const existing = await readCommandFile(slug);
    if (existing) {
      return NextResponse.json(
        { error: "slug_taken", message: `Command "${slug}" already exists.` },
        { status: 409 },
      );
    }

    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message:
            "A signed-in GitHub token is required to commit command files.",
        },
        { status: 401 },
      );
    }

    const command = await writeCommandFile({
      octokit: userOctokit,
      slug,
      description,
      argumentHint,
      body,
    });

    recordAudit(req, {
      action: "command.create",
      resource: slug,
      detail: `created command /${slug}`,
    });

    return NextResponse.json({ command });
  } catch (error: any) {
    console.error("[Commands] Error creating command:", error);
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
        message: error?.message ?? "Failed to create command",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
