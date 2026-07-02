/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern managed-goal-run
 * @ai-summary POST /api/kody/goals/managed/:id/run manually dispatches
 *   kody.yml for one managed goal.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";

import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import { recordAudit } from "@dashboard/lib/activity/audit";
import {
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import {
  managedGoalPath,
  type ManagedGoalRecord,
  type ManagedGoalState,
} from "@dashboard/lib/managed-goals";
import {
  listCompanyStoreGoalTemplateFiles,
  readManagedGoalFile,
  writeManagedGoalFile,
} from "@dashboard/lib/managed-goals-files";
import { runScheduledKodyOnRunner } from "@dashboard/lib/runners/kody-runner";
import {
  goalRunRequest,
  withStoreTarget,
} from "@dashboard/lib/runners/run-request";

function activeGoalResponse(
  goal: ManagedGoalRecord,
  runner: "pool" | "fly",
  machineId: string,
  ref: string,
) {
  return NextResponse.json({
    ok: true,
    runner,
    machineId,
    ref,
    goal,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const { id } = await params;
  try {
    managedGoalPath(id);
  } catch {
    return NextResponse.json({ error: "invalid_goal_id" }, { status: 400 });
  }

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json(
      {
        error: "no_user_token",
        message: "A signed-in GitHub token is required to dispatch workflow.",
      },
      { status: 401 },
    );
  }

  setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  try {
    const existing = await readManagedGoalFile(
      id,
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );

    let goal: ManagedGoalRecord | null = null;
    if (existing) {
      goal = {
        id,
        path: existing.path,
        state: existing.state,
        source: "local",
        recordType: "instance",
      };
    } else {
      const storeGoals = await listCompanyStoreGoalTemplateFiles(octokit);
      const storeGoal = storeGoals.find((candidate) => candidate.id === id);
      if (!storeGoal) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      const state: ManagedGoalState = {
        ...storeGoal.state,
        sourceTemplate:
          typeof storeGoal.state.sourceTemplate === "string"
            ? storeGoal.state.sourceTemplate
            : id,
      };
      const path = managedGoalPath(id);
      await writeManagedGoalFile({
        octokit,
        owner: headerAuth.owner,
        repo: headerAuth.repo,
        id,
        state,
        message: `chore(goals): prepare managed goal ${id} for manual run`,
      });
      goal = {
        id,
        path,
        state,
        source: "local",
        recordType: "instance",
      };
    }

    const run = await runScheduledKodyOnRunner(req, {
      taskId: `managed-goal-run-${id}-${Date.now()}`,
      runRequest: withStoreTarget(goalRunRequest(id), headerAuth),
    });
    if (!run.ok) {
      return NextResponse.json(
        {
          error: "runner_failed",
          message: run.error,
        },
        { status: run.status },
      );
    }

    recordAudit(req, {
      action: "goal.run",
      resource: id,
      detail: `manual runner dispatch for goal ${id}`,
    });

    return activeGoalResponse(goal, run.runner, run.machineId, run.ref);
  } catch (err: any) {
    console.error("[managed-goals/run] dispatch failed", err);
    return NextResponse.json(
      {
        error: "dispatch_failed",
        message: err?.message ?? "Failed to dispatch workflow",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
