/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern company-workflow-run
 * @ai-summary POST /api/kody/company/workflows/:id/run manually dispatches
 *   kody.yml for one runnable workflow-capability.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@dashboard/lib/auth";
import { recordAudit } from "@dashboard/lib/activity/audit";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { getEngineConfig } from "@dashboard/lib/engine/config";
import { runScheduledKodyOnRunner } from "@dashboard/lib/runners/kody-runner";
import {
  workflowRunRequest,
  withStoreTarget,
} from "@dashboard/lib/runners/run-request";
import { isWorkflowDefinitionId } from "@dashboard/lib/workflow-definitions";
import {
  readCompanyStoreCapabilityWorkflowDefinitionFile,
  readCompanyStoreWorkflowDefinitionFile,
  readWorkflowDefinitionFile,
} from "@dashboard/lib/workflow-definition-files";

function activeStringSet(values: string[] | undefined): Set<string> {
  return new Set(
    (values ?? []).filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    ),
  );
}

function workflowNotRunnableResponse() {
  return NextResponse.json(
    {
      error: "workflow_not_runnable",
      message:
        "Only capability-backed Store workflows can be run immediately right now.",
    },
    { status: 409 },
  );
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
  if (!isWorkflowDefinitionId(id)) {
    return NextResponse.json({ error: "invalid_workflow_id" }, { status: 400 });
  }

  setGitHubContext(
    headerAuth.owner,
    headerAuth.repo,
    headerAuth.token,
    headerAuth.storeRepoUrl,
    headerAuth.storeRef,
  );
  try {
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

    const { config } = await getEngineConfig(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
      { force: true },
    );
    const activeCapabilities = activeStringSet(
      config.company?.activeCapabilities,
    );
    const activeWorkflows = activeStringSet(config.company?.activeWorkflows);

    if (!activeCapabilities.has(id)) {
      const localWorkflow = await readWorkflowDefinitionFile(
        id,
        octokit,
        headerAuth.owner,
        headerAuth.repo,
      );
      if (localWorkflow) return workflowNotRunnableResponse();

      if (activeWorkflows.has(id)) {
        const storeWorkflow = await readCompanyStoreWorkflowDefinitionFile(
          id,
          octokit,
        );
        if (storeWorkflow) return workflowNotRunnableResponse();
      }

      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const workflow = await readCompanyStoreCapabilityWorkflowDefinitionFile(
      id,
      octokit,
    );
    if (!workflow) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (workflow.runnable !== true) return workflowNotRunnableResponse();

    const run = await runScheduledKodyOnRunner(req, {
      taskId: `company-workflow-${id}-${Date.now()}`,
      runRequest: withStoreTarget(workflowRunRequest(id), headerAuth),
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
      action: "workflow.run",
      resource: id,
      detail: `manual runner dispatch for workflow ${id}`,
    });

    return NextResponse.json({
      ok: true,
      runner: run.runner,
      machineId: run.machineId,
      ref: run.ref,
      workflow: id,
      action: id,
    });
  } catch (err: any) {
    console.error("[company-workflows/run] dispatch failed", err);
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
