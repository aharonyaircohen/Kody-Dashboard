/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern managed-goals-api
 * @ai-summary Managed goals API. Lists and creates engine goal todo files
 * under `todos/<id>.md` in the configured Kody state repo.
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
import { logger } from "@dashboard/lib/logger";
import { runScheduledKodyOnRunner } from "@dashboard/lib/runners/kody-runner";
import { scheduledFanoutRunRequest } from "@dashboard/lib/runners/run-request";
import {
  buildManagedGoalState,
  collapseManagedGoalRecordsForList,
  isManagedGoalTypeId,
  managedGoalTypeDefinition,
  managedGoalPath,
  SIMPLE_MANAGED_GOAL_TEMPLATE,
  slugifyManagedGoalId,
} from "@dashboard/lib/managed-goals";
import {
  listCompanyStoreGoalTemplateFiles,
  listManagedGoalFiles,
  readManagedGoalFile,
  writeManagedGoalFile,
} from "@dashboard/lib/managed-goals-files";
import {
  getEngineConfig,
  type ActiveGoalConfigEntry,
} from "@dashboard/lib/engine/config";

function activeGoalSlug(entry: ActiveGoalConfigEntry): string {
  return typeof entry === "string" ? entry : entry.template;
}

function mapGithubError(error: any, fallback: string, status = 500) {
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
    { error: fallback, message: error?.message ?? fallback },
    { status },
  );
}

const routeStepSchema = z.object({
  stage: z.string().min(1).max(80),
  evidence: z.string().min(1).max(80),
  capability: z.string().min(1).max(80),
  saveReport: z.boolean().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
});

const managedGoalScheduleSchema = z.enum([
  "manual",
  "15m",
  "1h",
  "1d",
  "7d",
  "30d",
]);
const preferredRunTimeSchema = z.object({
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_+./-]+$/),
});
const loopTargetSchema = z.object({
  type: z.enum(["capability", "goal", "workflow"]),
  id: z.string().min(1).max(80),
});

const createManagedGoalSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  templateId: z.string().min(1).max(80).optional(),
  type: z.string().min(1).max(80).default("general"),
  outcome: z.string().min(1).max(500),
  schedule: managedGoalScheduleSchema.default("manual"),
  preferredRunTime: preferredRunTimeSchema.nullable().optional(),
  loopTarget: loopTargetSchema.optional(),
  saveReport: z.boolean().optional(),
  capabilities: z.array(z.string().min(1).max(80)).optional(),
  evidence: z.array(z.string().min(1).max(80)).default([]),
  route: z.array(routeStepSchema).default([]),
  actorLogin: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    if (!headerAuth) {
      return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
    }
    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }

    const localGoals = await listManagedGoalFiles(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    const visibleLocalGoals = collapseManagedGoalRecordsForList(localGoals);
    const { config } = await getEngineConfig(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    const activeGoalIds = new Set(
      (config.company?.activeGoals ?? []).map(activeGoalSlug),
    );
    const localIds = new Set(visibleLocalGoals.map((goal) => goal.id));
    const storeGoals =
      activeGoalIds.size > 0
        ? (await listCompanyStoreGoalTemplateFiles(octokit)).filter(
            (goal) => activeGoalIds.has(goal.id) && !localIds.has(goal.id),
          )
        : [];
    const goals = [...visibleLocalGoals, ...storeGoals].sort((a, b) =>
      a.id.localeCompare(b.id),
    );

    return NextResponse.json(
      { goals },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return mapGithubError(err, "failed_to_list_managed_goals");
  } finally {
    clearGitHubContext();
  }
}

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const payload = await req.json().catch(() => null);
    const parsed = createManagedGoalSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const usesTemplate =
      parsed.data.templateId === SIMPLE_MANAGED_GOAL_TEMPLATE ||
      parsed.data.type === SIMPLE_MANAGED_GOAL_TEMPLATE;
    const selectedType = isManagedGoalTypeId(parsed.data.type)
      ? managedGoalTypeDefinition(parsed.data.type)
      : null;
    const routeFreeRoutine = selectedType?.model === "agentLoop";
    if (
      !routeFreeRoutine &&
      !usesTemplate &&
      (parsed.data.evidence.length === 0 || parsed.data.route.length === 0)
    ) {
      return NextResponse.json(
        {
          error: "invalid_body",
          message:
            "Managed goals need evidence and route unless created from a template.",
        },
        { status: 400 },
      );
    }

    const actorResult = await verifyActorLogin(req, parsed.data.actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;
    if (!headerAuth) {
      return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
    }

    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }

    const goalId =
      slugifyManagedGoalId(parsed.data.id ?? "") ||
      slugifyManagedGoalId(parsed.data.outcome);
    if (!goalId) {
      return NextResponse.json({ error: "invalid_goal_id" }, { status: 400 });
    }

    const existing = await readManagedGoalFile(
      goalId,
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    if (existing) {
      return NextResponse.json(
        { error: "goal_exists", message: `Goal "${goalId}" already exists.` },
        { status: 409 },
      );
    }

    const state = buildManagedGoalState(parsed.data);
    const path = managedGoalPath(goalId);
    await writeManagedGoalFile({
      octokit,
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      id: goalId,
      state,
      message: `chore(goals): create managed goal ${goalId}`,
    });

    let engineDispatched = false;
    const run = await runScheduledKodyOnRunner(req, {
      taskId: `managed-goal-create-${goalId}-${Date.now()}`,
      runRequest: scheduledFanoutRunRequest(),
    });
    if (run.ok) {
      engineDispatched = true;
      logger.info(
        {
          goalId,
          owner: headerAuth.owner,
          repo: headerAuth.repo,
          ref: run.ref,
          runner: run.runner,
          machineId: run.machineId,
        },
        "managed-goals: engine runner started on create",
      );
    } else {
      logger.warn(
        { err: run.error, goalId, status: run.status },
        "managed-goals: runner failed; scheduler can pick it up",
      );
    }

    return NextResponse.json(
      {
        goal: { id: goalId, path, state },
        engineDispatched,
      },
      { status: 201 },
    );
  } catch (err) {
    return mapGithubError(err, "failed_to_create_managed_goal");
  } finally {
    clearGitHubContext();
  }
}
