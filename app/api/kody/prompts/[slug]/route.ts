/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern prompts-api
 * @ai-summary Prompt detail API — GET reads a single prompt (repo or
 *   built-in), PATCH updates a repo prompt, DELETE removes it. Built-ins
 *   are read-only; trying to mutate one returns 405. Backed by
 *   `.kody/prompts/<slug>.md` via the GitHub contents API.
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
  readPromptFile,
  writePromptFile,
  deletePromptFile,
  isValidSlug,
  listPrompts,
} from "@dashboard/lib/prompts";
import { recordAudit } from "@dashboard/lib/activity/audit";

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
    // Repo file wins; if absent, fall back to a built-in match through listPrompts.
    const repoFile = await readPromptFile(slug);
    if (repoFile) return NextResponse.json({ prompt: repoFile });
    const all = await listPrompts();
    const builtin = all.find((p) => p.slug === slug);
    if (!builtin)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ prompt: builtin });
  } catch (error: any) {
    console.error("[Prompts] Error fetching prompt:", error);
    return NextResponse.json(
      {
        error: "fetch_failed",
        message: error?.message ?? "Failed to fetch prompt",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

const updatePromptSchema = z.object({
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
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
    }

    const payload = await req.json();
    const { description, argumentHint, body, actorLogin } =
      updatePromptSchema.parse(payload);

    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message:
            "A signed-in GitHub token is required to commit prompt files.",
        },
        { status: 401 },
      );
    }

    // If there is no repo file yet, treat PATCH as "fork the built-in"
    // by writing a new repo file seeded with the built-in's current
    // contents merged with the requested changes.
    const existing = await readPromptFile(slug);
    if (existing) {
      const prompt = await writePromptFile({
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
        action: "prompt.update",
        resource: slug,
        detail: `edited prompt /${slug}`,
      });
      return NextResponse.json({ prompt });
    }

    const all = await listPrompts();
    const builtin = all.find((p) => p.slug === slug);
    if (!builtin)
      return NextResponse.json({ error: "not_found" }, { status: 404 });

    const prompt = await writePromptFile({
      octokit: userOctokit,
      slug,
      description: description ?? builtin.description,
      argumentHint:
        argumentHint === undefined
          ? builtin.argumentHint
          : (argumentHint ?? ""),
      body: body ?? builtin.body,
      message: `feat(prompts): override built-in ${slug}`,
    });
    recordAudit(req, {
      action: "prompt.update",
      resource: slug,
      detail: `forked built-in prompt /${slug}`,
    });
    return NextResponse.json({ prompt });
  } catch (error: any) {
    console.error("[Prompts] Error updating prompt:", error);
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
        message: error?.message ?? "Failed to update prompt",
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

    const existing = await readPromptFile(slug);
    if (!existing) {
      // Built-ins can't be deleted from the dashboard. The user can
      // either fork-and-edit, or drop `.kody/prompts/.disable-builtins`
      // to suppress every built-in.
      return NextResponse.json(
        {
          error: "builtin_readonly",
          message:
            "Built-in prompts cannot be deleted. Use the disable-builtins toggle to hide them all, or override this slug by editing it (the dashboard will fork it into your repo).",
        },
        { status: 405 },
      );
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
            "A signed-in GitHub token is required to delete prompt files.",
        },
        { status: 401 },
      );
    }

    await deletePromptFile(userOctokit, slug);
    recordAudit(req, {
      action: "prompt.delete",
      resource: slug,
      detail: `deleted prompt /${slug}`,
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Prompts] Error deleting prompt:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "delete_failed",
        message: error?.message ?? "Failed to delete prompt",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
