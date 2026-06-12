/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern duties-api
 * @ai-summary Duty Control API — GET lists duties, POST creates one.
 *   A duty is a folder at `.kody/duties/<slug>/` in the connected repo:
 *   `profile.json` holds metadata and `duty.md` holds the readable body.
 *   The kody engine's scheduler enumerates those folders.
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
  listDutyFiles,
  readDutyFile,
  writeDutyFile,
  isValidSlug,
} from "@dashboard/lib/duties-files";
import {
  DEFAULT_DUTY_STAGE_TEMPLATE,
  DUTY_STAGE_TEMPLATE_SLUGS,
} from "@dashboard/lib/duties/stage-templates";
import { recordAudit } from "@dashboard/lib/activity/audit";

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const duties = (await listDutyFiles()).sort((a, b) =>
      a.slug.localeCompare(b.slug),
    );
    return NextResponse.json({ duties });
  } catch (error: any) {
    console.error("[Duties] Error fetching duties:", error);

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
      { duties: [], error: error?.message || "Failed to fetch duties" },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

const createDutySchema = z.object({
  slug: z.string().min(1).max(64).optional(),
  title: z.string().min(1),
  body: z.string().default(""),
  schedule: z
    .enum(["15m", "30m", "1h", "2h", "6h", "12h", "1d", "3d", "7d", "manual"])
    .nullable()
    .optional(),
  disabled: z.boolean().optional(),
  staff: z.string().min(1).nullable().optional(),
  stage: z.enum(DUTY_STAGE_TEMPLATE_SLUGS).nullable().optional(),
  action: z.string().min(1).max(64).nullable().optional(),
  mentions: z.array(z.string()).optional(),
  executable: z.string().min(1).max(64).nullable().optional(),
  executables: z.array(z.string()).optional(),
  dutyTools: z.array(z.string()).optional(),
  tickScript: z.string().nullable().optional(),
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
      schedule,
      disabled,
      staff,
      stage,
      action,
      mentions,
      executable,
      executables,
      dutyTools,
      tickScript,
      actorLogin,
    } = createDutySchema.parse(payload);

    const slug = requestedSlug ?? slugifyTitle(title);
    if (!slug || !isValidSlug(slug)) {
      return NextResponse.json(
        {
          error: "invalid_slug",
          message:
            "Duty slug must be lowercase letters, digits, dashes, or underscores.",
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
            "Duty action must be lowercase letters, digits, dashes, or underscores.",
        },
        { status: 400 },
      );
    }
    const executableSlug = normalizeOptionalSlug(executable);
    if (executableSlug && !isValidSlug(executableSlug)) {
      return NextResponse.json(
        {
          error: "invalid_executable",
          message:
            "Executable slug must be lowercase letters, digits, dashes, or underscores.",
        },
        { status: 400 },
      );
    }

    const existing = await readDutyFile(slug);
    if (existing) {
      return NextResponse.json(
        { error: "slug_taken", message: `Duty "${slug}" already exists.` },
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
          message: "A signed-in GitHub token is required to commit duty folders.",
        },
        { status: 401 },
      );
    }

    const duty = await writeDutyFile({
      octokit: userOctokit,
      slug,
      title,
      body,
      schedule: schedule ?? null,
      disabled: disabled === true,
      staff: staff ?? null,
      stage: stage ?? DEFAULT_DUTY_STAGE_TEMPLATE,
      action: actionSlug,
      mentions: normalizeMentions(mentions),
      executable: executableSlug,
      executables: normalizeList(executables),
      dutyTools: normalizeList(dutyTools),
      tickScript: tickScript?.trim() ? tickScript.trim() : null,
    });

    recordAudit(req, {
      action: "duty.create",
      resource: slug,
      duty: slug,
      staff: staff ?? null,
      detail: `created duty "${title}"${schedule ? ` (${schedule})` : ""}`,
    });

    return NextResponse.json({ duty });
  } catch (error: any) {
    console.error("[Duties] Error creating duty:", error);

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
        message: error?.message ?? "Failed to create duty",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
