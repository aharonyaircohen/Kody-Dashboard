/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern agent-api
 * @ai-summary Agent Control API — GET lists agent, POST creates one.
 *   An agent is a markdown file at `agents/<slug>.md` in the state repo.
 *   Duplicated from the capabilities API; the manual "Run now"
 *   path reuses the engine's `capability-tick` plumbing.
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
  listResolvedAgentFiles,
  writeAgentFile,
  isValidSlug,
  readAgentFile,
} from "@dashboard/lib/agent-files";
import { getEngineConfig } from "@dashboard/lib/engine/config";
import { recordAudit } from "@dashboard/lib/activity/audit";

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
    const activeAgents = new Set<string>();
    const octokit = await getUserOctokit(req);
    if (octokit && headerAuth) {
      const { config } = await getEngineConfig(
        octokit,
        headerAuth.owner,
        headerAuth.repo,
      );
      for (const slug of config.company?.activeAgents ?? []) {
        activeAgents.add(slug);
      }
    }
    const agent = (await listResolvedAgentFiles()).filter(
      (item) => item.source !== "store" || activeAgents.has(item.slug),
    );
    return NextResponse.json({ agent }, { headers: NO_STORE_HEADERS });
  } catch (error: any) {
    console.error("[Agent] Error fetching agent:", error);

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
      { agent: [], error: error?.message || "Failed to fetch agent" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  } finally {
    clearGitHubContext();
  }
}

const createAgentSchema = z.object({
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
    setGitHubContext(
      headerAuth.owner,
      headerAuth.repo,
      headerAuth.token,
      headerAuth.storeRepoUrl,
      headerAuth.storeRef,
    );

  try {
    const payload = await req.json();
    const {
      slug: requestedSlug,
      title,
      body,
      actorLogin,
    } = createAgentSchema.parse(payload);

    const slug = requestedSlug ?? slugifyTitle(title);
    if (!slug || !isValidSlug(slug)) {
      return NextResponse.json(
        {
          error: "invalid_slug",
          message:
            "Agent slug must be lowercase letters, digits, dashes, or underscores.",
        },
        { status: 400 },
      );
    }

    const existing = await readAgentFile(slug);
    if (existing) {
      return NextResponse.json(
        {
          error: "slug_taken",
          message: `Agent member "${slug}" already exists.`,
        },
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
            "A signed-in GitHub token is required to commit agent files.",
        },
        { status: 401 },
      );
    }

    const agentMember = await writeAgentFile({
      octokit: userOctokit,
      slug,
      title,
      body,
    });

    recordAudit(req, {
      action: "agent.create",
      resource: slug,
      agent: slug,
      detail: `created agent "${title}"`,
    });

    return NextResponse.json({ agentMember });
  } catch (error: any) {
    console.error("[Agent] Error creating agent:", error);

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
        message: error?.message ?? "Failed to create agent",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
