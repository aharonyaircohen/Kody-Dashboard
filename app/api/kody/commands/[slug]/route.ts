/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern commands-api
 * @ai-summary Command detail API — GET reads a single repo, activated Store, or
 * fallback built-in command. PATCH writes a repo command; DELETE removes a repo
 * command or clears an activated Store command reference. Fallback built-ins are
 * read-only.
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
  readCommandFile,
  writeCommandFile,
  deleteCommandFile,
  isValidSlug,
  listCommands,
} from "@dashboard/lib/commands";
import { recordAudit } from "@dashboard/lib/activity/audit";
import {
  getEngineConfig,
  writeConfigPatch,
} from "@dashboard/lib/engine/config";

async function readActiveCommands(
  req: NextRequest,
  headerAuth: ReturnType<typeof getRequestAuth>,
): Promise<string[]> {
  const octokit = await getUserOctokit(req);
  if (!octokit || !headerAuth) return [];
  const { config } = await getEngineConfig(
    octokit,
    headerAuth.owner,
    headerAuth.repo,
  );
  return config.company?.activeCommands ?? [];
}

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
    // Repo file wins; if absent, fall back to activated Store or built-in commands.
    const repoFile = await readCommandFile(slug);
    if (repoFile) return NextResponse.json({ command: repoFile });
    const activeCommands = new Set(await readActiveCommands(req, headerAuth));
    const all = await listCommands({ activeStoreSlugs: activeCommands });
    const baseCommand = all.find((p) => p.slug === slug);
    if (!baseCommand)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ command: baseCommand });
  } catch (error: any) {
    console.error("[Commands] Error fetching command:", error);
    return NextResponse.json(
      {
        error: "fetch_failed",
        message: error?.message ?? "Failed to fetch command",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

const updateCommandSchema = z.object({
  description: z.string().optional(),
  argumentHint: z.string().nullable().optional(),
  body: z.string().min(1).optional(),
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

    const payload = await req.json();
    const { description, argumentHint, body, actorLogin } =
      updateCommandSchema.parse(payload);

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

    // If there is no repo file yet, treat PATCH as "fork the shared command"
    // by writing a new repo file seeded with the shared command's current
    // contents merged with the requested changes.
    const existing = await readCommandFile(slug);
    if (existing) {
      const command = await writeCommandFile({
        octokit: userOctokit,
        slug,
        description: description ?? existing.description,
        argumentHint:
          argumentHint === undefined
            ? existing.argumentHint
            : (argumentHint ?? ""),
        body: body ?? existing.body,
        sha: existing.sha,
      });
      recordAudit(req, {
        action: "command.update",
        resource: slug,
        detail: `edited command /${slug}`,
      });
      return NextResponse.json({ command });
    }

    const activeCommands = new Set(await readActiveCommands(req, headerAuth));
    const all = await listCommands({ activeStoreSlugs: activeCommands });
    const baseCommand = all.find((p) => p.slug === slug);
    if (!baseCommand)
      return NextResponse.json({ error: "not_found" }, { status: 404 });

    const command = await writeCommandFile({
      octokit: userOctokit,
      slug,
      description: description ?? baseCommand.description,
      argumentHint:
        argumentHint === undefined
          ? baseCommand.argumentHint
          : (argumentHint ?? ""),
      body: body ?? baseCommand.body,
      message: `feat(commands): override shared ${slug}`,
    });
    recordAudit(req, {
      action: "command.update",
      resource: slug,
      detail: `forked shared command /${slug}`,
    });
    return NextResponse.json({ command });
  } catch (error: any) {
    console.error("[Commands] Error updating command:", error);
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
        message: error?.message ?? "Failed to update command",
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
            "A signed-in GitHub token is required to delete command files.",
        },
        { status: 401 },
      );
    }

    const existing = await readCommandFile(slug);
    if (!existing) {
      if (headerAuth) {
        const { config } = await getEngineConfig(
          userOctokit,
          headerAuth.owner,
          headerAuth.repo,
          { force: true },
        );
        const activeCommands = config.company?.activeCommands ?? [];
        if (activeCommands.includes(slug)) {
          const nextActiveCommands = activeCommands.filter(
            (value) => value !== slug,
          );
          await writeConfigPatch(
            userOctokit,
            headerAuth.owner,
            headerAuth.repo,
            {
              activeCommands:
                nextActiveCommands.length > 0 ? nextActiveCommands : null,
            },
            `chore(kody): remove store command ${slug}`,
          );
          recordAudit(req, {
            action: "command.removeStoreReference",
            resource: slug,
            detail: `removed Store command /${slug}`,
          });
          return NextResponse.json({
            success: true,
            removedStoreReference: true,
          });
        }
      }

      return NextResponse.json(
        {
          error: "shared_readonly",
          message:
            "Shared commands cannot be deleted. Remove imported Store commands from this repo in Store Catalog, or edit to create a repo override.",
        },
        { status: 405 },
      );
    }

    await deleteCommandFile(userOctokit, slug);
    recordAudit(req, {
      action: "command.delete",
      resource: slug,
      detail: `deleted command /${slug}`,
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Commands] Error deleting command:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "delete_failed",
        message: error?.message ?? "Failed to delete command",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
