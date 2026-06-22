/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern duties-api
 * @ai-summary Duty detail API — GET reads a single duty folder, PATCH
 *   updates metadata/body/executable assignment, DELETE removes the folder.
 *   Backed by `.kody/duties/<slug>/{profile.json,duty.md}` via GitHub.
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
  readDutyFile,
  readResolvedDutyFile,
  writeDutyFile,
  deleteDutyFile,
  isValidSlug,
} from "@dashboard/lib/duties-files";
import { readAgentFile } from "@dashboard/lib/agent-files";
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
    const duty = await readResolvedDutyFile(slug);
    if (!duty) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ duty });
  } catch (error: any) {
    console.error("[Duties] Error fetching duty:", error);
    return NextResponse.json(
      {
        error: "fetch_failed",
        message: error?.message ?? "Failed to fetch duty",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

const updateDutySchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
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
  executable: z.string().min(1).max(64).nullable().optional(),
  executables: z.array(z.string()).optional(),
  dutyTools: z.array(z.string()).optional(),
  tickScript: z.string().nullable().optional(),
  readsFrom: z.array(z.string()).optional(),
  writesTo: z.array(z.string()).optional(),
  actorLogin: z.string().optional(),
});

/**
 * Clean a client-supplied mentions list before it hits profile metadata:
 * drop a leading `@`, trim whitespace, drop empties.
 */
function normalizeMentions(mentions: string[]): string[] {
  return mentions
    .map((m) => m.trim().replace(/^@/, ""))
    .filter((m) => m.length > 0);
}

function normalizeList(values: string[]): string[] {
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

    const existing = await readDutyFile(slug);
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const payload = await req.json();
    const {
      title,
      body,
    schedule,
    disabled,
    capabilityKind,
    agent,
      reviewer,
      action,
      mentions,
      executable,
      executables,
      dutyTools,
      tickScript,
      readsFrom,
      writesTo,
      actorLogin,
    } = updateDutySchema.parse(payload);

    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const nextAction =
      action === undefined
        ? (existing.action ?? slug)
        : (normalizeOptionalSlug(action) ?? slug);
    if (!isValidSlug(nextAction)) {
      return NextResponse.json(
        {
          error: "invalid_action",
          message:
            "Duty action must be lowercase letters, digits, dashes, or underscores.",
        },
        { status: 400 },
      );
    }
    const nextExecutable =
      executable === undefined
        ? existing.executable
        : normalizeOptionalSlug(executable);
    if (nextExecutable && !isValidSlug(nextExecutable)) {
      return NextResponse.json(
        {
          error: "invalid_executable",
          message:
            "Executable slug must be lowercase letters, digits, dashes, or underscores.",
        },
        { status: 400 },
      );
    }
    const nextAgent =
      agent === undefined ? existing.agent : normalizeAgentSlug(agent);
    const nextReviewer =
      reviewer === undefined ? existing.reviewer : normalizeAgentSlug(reviewer);
    if (agent !== undefined) {
      const agentError = await validateAgentRole(nextAgent, "agent");
      if (agentError) return agentError;
    }
    if (reviewer !== undefined) {
      const reviewerError = await validateAgentRole(nextReviewer, "reviewer");
      if (reviewerError) return reviewerError;
    }

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json(
        {
          error: "no_user_token",
          message:
            "A signed-in GitHub token is required to commit duty folders.",
        },
        { status: 401 },
      );
    }

    const duty = await writeDutyFile({
      octokit: userOctokit,
      slug,
      title: title ?? existing.title,
      body: body ?? existing.body,
    schedule: schedule === undefined ? existing.schedule : schedule,
    disabled: disabled === undefined ? existing.disabled : disabled,
    capabilityKind:
      capabilityKind === undefined ? existing.capabilityKind : capabilityKind,
    agent: nextAgent,
      reviewer: nextReviewer,
      action: nextAction,
      // Read-merge: omitting `mentions` preserves the existing list rather
      // than clearing it. An explicit `[]` clears it.
      mentions:
        mentions === undefined
          ? existing.mentions
          : normalizeMentions(mentions),
      executable: nextExecutable,
      executables:
        executables === undefined
          ? existing.executables
          : normalizeList(executables),
      dutyTools:
        dutyTools === undefined ? existing.dutyTools : normalizeList(dutyTools),
      tickScript:
        tickScript === undefined
          ? existing.tickScript
          : tickScript?.trim()
            ? tickScript.trim()
            : null,
      readsFrom:
        readsFrom === undefined ? existing.readsFrom : normalizeList(readsFrom),
      writesTo:
        writesTo === undefined ? existing.writesTo : normalizeList(writesTo),
      sha: existing.sha,
    });

    recordAudit(req, {
      action: "duty.update",
      resource: slug,
      duty: slug,
      agent: duty.agent ?? null,
      detail: "edited duty",
    });

    return NextResponse.json({ duty });
  } catch (error: any) {
    console.error("[Duties] Error updating duty:", error);

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
        message: error?.message ?? "Failed to update duty",
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

    const existing = await readDutyFile(slug);
    if (!existing) {
      return NextResponse.json({ success: true, alreadyMissing: true });
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
            "A signed-in GitHub token is required to delete duty folders.",
        },
        { status: 401 },
      );
    }

    await deleteDutyFile(userOctokit, slug);

    recordAudit(req, {
      action: "duty.delete",
      resource: slug,
      duty: slug,
      agent: existing.agent ?? null,
      detail: "deleted duty",
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Duties] Error deleting duty:", error);
    if (error?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "delete_failed",
        message: error?.message ?? "Failed to delete duty",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
