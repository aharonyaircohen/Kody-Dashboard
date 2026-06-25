/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern agentResponsibilities-api
 * @ai-summary AgentResponsibility Control API — GET lists agentResponsibilities, POST creates one.
 *   A agentResponsibility is a folder at `agent-responsibilities/<slug>/` in the state repo:
 *   `profile.json` holds metadata and `agent-responsibility.md` holds the readable body.
 * Goals and loops dispatch these folders.
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
  listAgentResponsibilityFiles,
  readAgentResponsibilityFile,
  writeAgentResponsibilityFile,
  isValidSlug,
} from "@dashboard/lib/agent-responsibilities-files";
import { readAgentFile } from "@dashboard/lib/agent-files";
import { getEngineConfig } from "@dashboard/lib/engine/config";
import { recordAudit } from "@dashboard/lib/activity/audit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

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
    const activeAgentResponsibilities = new Set<string>();
    const octokit = await getUserOctokit(req);
    if (octokit && headerAuth) {
      const { config } = await getEngineConfig(
        octokit,
        headerAuth.owner,
        headerAuth.repo,
      );
      for (const slug of config.company?.activeAgentResponsibilities ?? []) {
        activeAgentResponsibilities.add(slug);
      }
    }
    const agentResponsibilities = (await listAgentResponsibilityFiles())
      .filter(
        (item) =>
          item.source !== "store" || activeAgentResponsibilities.has(item.slug),
      )
      .sort((a, b) => a.slug.localeCompare(b.slug));
    return NextResponse.json(
      { agentResponsibilities },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error: any) {
    console.error(
      "[AgentResponsibilities] Error fetching agentResponsibilities:",
      error,
    );

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
      {
        agentResponsibilities: [],
        error: error?.message || "Failed to fetch agentResponsibilities",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  } finally {
    clearGitHubContext();
  }
}

const createAgentResponsibilitySchema = z.object({
  slug: z.string().min(1).max(64).optional(),
  title: z.string().min(1),
  body: z.string().default(""),
  schedule: z
    .enum(["15m", "30m", "1h", "2h", "6h", "12h", "1d", "3d", "7d", "manual"])
    .nullable()
    .optional(),
  disabled: z.boolean().optional(),
  capabilityKind: z.enum(["observe", "act", "verify"]).nullable().optional(),
  agent: z.string().min(1).nullable().optional(),
  reviewer: z.string().min(1).nullable().optional(),
  action: z.string().min(1).max(64).nullable().optional(),
  mentions: z.array(z.string()).optional(),
  agentAction: z.string().min(1).max(64).nullable().optional(),
  agentActions: z.array(z.string()).optional(),
  agentResponsibilityTools: z.array(z.string()).optional(),
  tickScript: z.string().nullable().optional(),
  readsFrom: z.array(z.string()).optional(),
  writesTo: z.array(z.string()).optional(),
  actorLogin: z.string().optional(),
});

/**
 * Clean a client-supplied mentions list before it hits profile metadata:
 * drop a leading `@`, trim whitespace, drop empties.
 */
function normalizeMentions(mentions?: string[]): string[] {
  if (!mentions) return [];
  return mentions
    .map((m) => m.trim().replace(/^@/, ""))
    .filter((m) => m.length > 0);
}

function normalizeList(values?: string[]): string[] {
  if (!values) return [];
  return values.map((v) => v.trim()).filter((v) => v.length > 0);
}

function normalizeOptionalSlug(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeAgentSlug(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/^@/, "") ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

async function validateAgentRole(
  slug: string | null,
  field: "agent" | "reviewer",
): Promise<NextResponse | null> {
  if (!slug) return null;
  if (!isValidSlug(slug)) {
    return NextResponse.json(
      {
        error: `invalid_${field}`,
        message: `${field} must be an agent slug.`,
      },
      { status: 400 },
    );
  }
  const agent = await readAgentFile(slug);
  if (!agent) {
    return NextResponse.json(
      {
        error: `unknown_${field}`,
        message: `${field} must reference an existing agent.`,
      },
      { status: 400 },
    );
  }
  return null;
}

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
      schedule,
      disabled,
      capabilityKind,
      agent,
      reviewer,
      action,
      mentions,
      agentAction,
      agentActions,
      agentResponsibilityTools,
      tickScript,
      readsFrom,
      writesTo,
      actorLogin,
    } = createAgentResponsibilitySchema.parse(payload);

    const slug = requestedSlug ?? slugifyTitle(title);
    if (!slug || !isValidSlug(slug)) {
      return NextResponse.json(
        {
          error: "invalid_slug",
          message:
            "AgentResponsibility slug must be lowercase letters, digits, dashes, or underscores.",
        },
        { status: 400 },
      );
    }
    const actionSlug = normalizeOptionalSlug(action) ?? slug;
    if (!isValidSlug(actionSlug)) {
      return NextResponse.json(
        {
          error: "invalid_action",
          message:
            "AgentResponsibility action must be lowercase letters, digits, dashes, or underscores.",
        },
        { status: 400 },
      );
    }
    const agentActionSlug = normalizeOptionalSlug(agentAction);
    if (agentActionSlug && !isValidSlug(agentActionSlug)) {
      return NextResponse.json(
        {
          error: "invalid_agentAction",
          message:
            "AgentAction slug must be lowercase letters, digits, dashes, or underscores.",
        },
        { status: 400 },
      );
    }
    const agentSlug = normalizeAgentSlug(agent);
    const reviewerSlug = normalizeAgentSlug(reviewer);
    const agentError = await validateAgentRole(agentSlug, "agent");
    if (agentError) return agentError;
    const reviewerError = await validateAgentRole(reviewerSlug, "reviewer");
    if (reviewerError) return reviewerError;

    const existing = await readAgentResponsibilityFile(slug);
    if (existing) {
      return NextResponse.json(
        {
          error: "slug_taken",
          message: `AgentResponsibility "${slug}" already exists.`,
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
            "A signed-in GitHub token is required to commit agentResponsibility folders.",
        },
        { status: 401 },
      );
    }

    const agentResponsibility = await writeAgentResponsibilityFile({
      octokit: userOctokit,
      slug,
      title,
      body,
      schedule: schedule ?? null,
      disabled: disabled === true,
      capabilityKind: capabilityKind ?? null,
      agent: agentSlug,
      reviewer: reviewerSlug,
      action: actionSlug,
      mentions: normalizeMentions(mentions),
      agentAction: agentActionSlug,
      agentActions: normalizeList(agentActions),
      agentResponsibilityTools: normalizeList(agentResponsibilityTools),
      tickScript: tickScript?.trim() ? tickScript.trim() : null,
      readsFrom: normalizeList(readsFrom),
      writesTo: normalizeList(writesTo),
    });

    recordAudit(req, {
      action: "agentResponsibility.create",
      resource: slug,
      agentResponsibility: slug,
      agent: agent ?? null,
      detail: `created agentResponsibility "${title}"`,
    });

    return NextResponse.json({ agentResponsibility });
  } catch (error: any) {
    console.error(
      "[AgentResponsibilities] Error creating agentResponsibility:",
      error,
    );

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
        message: error?.message ?? "Failed to create agentResponsibility",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
