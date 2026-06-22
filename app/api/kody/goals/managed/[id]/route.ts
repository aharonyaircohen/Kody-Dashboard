/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern managed-goal-detail-api
 * @ai-summary Updates and deletes engine managed goal state files under
 * `kody-state:.kody/goals/instances/<id>/state.json`.
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
  buildManagedGoalState,
  managedGoalPath,
  type ManagedGoalState,
} from "@dashboard/lib/managed-goals";
import {
  deleteManagedGoalFile,
  listCompanyStoreGoalTemplateFiles,
  readManagedGoalFile,
  writeManagedGoalFile,
} from "@dashboard/lib/managed-goals-files";

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
  duty: z.string().min(1).max(80),
  executable: z.string().min(1).max(80).optional(),
  args: z.record(z.string(), z.unknown()).optional(),
});

const managedGoalScheduleSchema = z.enum(["manual", "1h", "1d", "7d", "30d"]);

const updateManagedGoalSchema = z.object({
  state: z.enum(["inactive", "active", "paused"]).optional(),
  pausedReason: z.string().max(500).optional(),
  type: z.string().min(1).max(80).optional(),
  outcome: z.string().min(1).max(500).optional(),
  schedule: managedGoalScheduleSchema.optional(),
  duties: z.array(z.string().min(1).max(80)).optional(),
  evidence: z.array(z.string().min(1).max(80)).optional(),
  route: z.array(routeStepSchema).optional(),
  actorLogin: z.string().optional(),
});

function isStoreBackedGoalState(state: ManagedGoalState): boolean {
  return state.kind === "template" || state.template === true;
}

function isStateOnlyUpdate(
  data: z.infer<typeof updateManagedGoalSchema>,
): boolean {
  return (
    data.state !== undefined &&
    data.type === undefined &&
    data.outcome === undefined &&
    data.schedule === undefined &&
    data.duties === undefined &&
    data.evidence === undefined &&
    data.route === undefined
  );
}

function instantiateStoreGoalState(
  storeState: ManagedGoalState,
  id: string,
  state: ManagedGoalState["state"],
  pausedReason?: string,
): ManagedGoalState {
  const nextState: ManagedGoalState = {
    version: 1,
    sourceTemplate:
      typeof storeState.sourceTemplate === "string"
        ? storeState.sourceTemplate
        : id,
    state,
    type: storeState.type,
    destination: storeState.destination,
    duties: storeState.duties,
    route: storeState.route,
    schedule: storeState.schedule ?? "manual",
    ...(typeof storeState.stage === "string"
      ? { stage: storeState.stage }
      : {}),
    facts: { ...storeState.facts },
    blockers: [],
  };
  if (state === "paused" && pausedReason) {
    nextState.pausedReason = pausedReason;
  }
  return nextState;
}

async function getContext(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "no_user_token" }, { status: 401 });
  }

  return { headerAuth, octokit };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await getContext(req);
    if (context instanceof NextResponse) return context;

    const payload = await req.json().catch(() => null);
    const parsed = updateManagedGoalSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const actorResult = await verifyActorLogin(req, parsed.data.actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const { id } = await params;
    managedGoalPath(id);

    const existing = await readManagedGoalFile(
      id,
      context.octokit,
      context.headerAuth.owner,
      context.headerAuth.repo,
    );
    if (!existing) {
      const storeGoals = await listCompanyStoreGoalTemplateFiles(
        context.octokit,
      );
      const storeGoal = storeGoals.find((goal) => goal.id === id);
      if (storeGoal) {
        if (isStateOnlyUpdate(parsed.data)) {
          const nextState = instantiateStoreGoalState(
            storeGoal.state,
            id,
            parsed.data.state ?? storeGoal.state.state,
            parsed.data.pausedReason,
          );
          const path = managedGoalPath(id);
          await writeManagedGoalFile({
            octokit: context.octokit,
            owner: context.headerAuth.owner,
            repo: context.headerAuth.repo,
            id,
            state: nextState,
            message: `chore(goals): update managed goal ${id}`,
          });
          return NextResponse.json({ goal: { id, path, state: nextState } });
        }
        return NextResponse.json(
          {
            error: "store_goal_protected",
            message: "Store goals cannot be edited directly.",
          },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    if (isStoreBackedGoalState(existing.state)) {
      if (!isStateOnlyUpdate(parsed.data)) {
        return NextResponse.json(
          {
            error: "store_goal_protected",
            message: "Store goals cannot be edited from this repo.",
          },
          { status: 409 },
        );
      }

      const nextState = instantiateStoreGoalState(
        existing.state,
        id,
        parsed.data.state ?? existing.state.state,
        parsed.data.pausedReason,
      );
      await writeManagedGoalFile({
        octokit: context.octokit,
        owner: context.headerAuth.owner,
        repo: context.headerAuth.repo,
        id,
        state: nextState,
        sha: existing.sha,
        message: `chore(goals): update managed goal ${id}`,
      });
      return NextResponse.json({
        goal: { id, path: existing.path, state: nextState },
      });
    }

    const rebuilt = buildManagedGoalState({
      type: parsed.data.type ?? existing.state.type,
      outcome: parsed.data.outcome ?? existing.state.destination.outcome,
      schedule: parsed.data.schedule ?? existing.state.schedule ?? "manual",
      duties: parsed.data.duties ?? existing.state.duties,
      evidence: parsed.data.evidence ?? existing.state.destination.evidence,
      route: parsed.data.route ?? existing.state.route,
    });
    const evidenceSet = new Set(rebuilt.destination.evidence);
    const nextState: ManagedGoalState = {
      ...existing.state,
      state: parsed.data.state ?? existing.state.state,
      type: rebuilt.type,
      destination: rebuilt.destination,
      schedule: rebuilt.schedule,
      duties:
        parsed.data.duties === undefined && parsed.data.route === undefined
          ? existing.state.duties
          : rebuilt.duties,
      route:
        parsed.data.route === undefined ? existing.state.route : rebuilt.route,
      stage:
        parsed.data.route === undefined ? existing.state.stage : rebuilt.stage,
      facts: Object.fromEntries(
        Object.entries(existing.state.facts).filter(([key]) =>
          evidenceSet.has(key),
        ),
      ),
    };
    if (parsed.data.state === "paused" && parsed.data.pausedReason) {
      nextState.pausedReason = parsed.data.pausedReason;
    }
    if (parsed.data.state && parsed.data.state !== "paused") {
      delete nextState.pausedReason;
    }

    await writeManagedGoalFile({
      octokit: context.octokit,
      owner: context.headerAuth.owner,
      repo: context.headerAuth.repo,
      id,
      state: nextState,
      sha: existing.sha,
      message: `chore(goals): update managed goal ${id}`,
    });

    return NextResponse.json({
      goal: { id, path: existing.path, state: nextState },
    });
  } catch (err: any) {
    return mapGithubError(err, "failed_to_update_managed_goal");
  } finally {
    clearGitHubContext();
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await getContext(req);
    if (context instanceof NextResponse) return context;

    const { id } = await params;
    managedGoalPath(id);

    const actorResult = await verifyActorLogin(req, undefined);
    if (actorResult instanceof NextResponse) return actorResult;

    const existing = await readManagedGoalFile(
      id,
      context.octokit,
      context.headerAuth.owner,
      context.headerAuth.repo,
    );
    if (!existing) {
      const storeGoals = await listCompanyStoreGoalTemplateFiles(
        context.octokit,
      );
      if (storeGoals.some((goal) => goal.id === id)) {
        return NextResponse.json(
          {
            error: "store_goal_protected",
            message: "Store goals cannot be deleted from this repo.",
          },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (typeof existing.state.sourceTemplate === "string") {
      return NextResponse.json(
        {
          error: "store_goal_protected",
          message: "Store goals cannot be deleted from this repo.",
        },
        { status: 409 },
      );
    }

    await deleteManagedGoalFile({
      octokit: context.octokit,
      owner: context.headerAuth.owner,
      repo: context.headerAuth.repo,
      id,
      sha: existing.sha,
      message: `chore(goals): delete managed goal ${id}`,
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return mapGithubError(err, "failed_to_delete_managed_goal");
  } finally {
    clearGitHubContext();
  }
}
