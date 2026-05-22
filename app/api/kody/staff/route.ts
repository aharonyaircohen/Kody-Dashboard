/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern workers-api
 * @ai-summary Worker Control API — GET lists workers, POST creates one.
 *   A worker is a markdown file at `.kody/workers/<slug>.md` in the
 *   connected repo. Duplicated from the jobs API; the manual "Run now"
 *   path reuses the engine's `job-tick` plumbing verbatim.
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
  listWorkerFiles,
  readWorkerFile,
  writeWorkerFile,
  isValidSlug,
} from "@dashboard/lib/workers-files";

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const workers = await listWorkerFiles();
    return NextResponse.json({ workers });
  } catch (error: any) {
    console.error("[Workers] Error fetching workers:", error);

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
      { workers: [], error: error?.message || "Failed to fetch workers" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

const createWorkerSchema = z.object({
  slug: z.string().min(1).max(64).optional(),
  title: z.string().min(1),
  body: z.string().default(""),
  actorLogin: z.string().optional(),
});

function slugifyTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64);
}

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const payload = await req.json();
    const {
      slug: requestedSlug,
      title,
      body,
      actorLogin,
    } = createWorkerSchema.parse(payload);

    const slug = requestedSlug ?? slugifyTitle(title);
    if (!slug || !isValidSlug(slug)) {
      return NextResponse.json(
        {
          error: "invalid_slug",
          message:
            "Worker slug must be lowercase letters, digits, dashes, or underscores.",
        },
        { status: 400 },
      );
    }

    const existing = await readWorkerFile(slug);
    if (existing) {
      return NextResponse.json(
        { error: "slug_taken", message: `Worker "${slug}" already exists.` },
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
            "A signed-in GitHub token is required to commit worker files.",
        },
        { status: 401 },
      );
    }

    const worker = await writeWorkerFile({
      octokit: userOctokit,
      slug,
      title,
      body,
    });

    return NextResponse.json({ worker });
  } catch (error: any) {
    console.error("[Workers] Error creating worker:", error);

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
        message: error?.message ?? "Failed to create worker",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
