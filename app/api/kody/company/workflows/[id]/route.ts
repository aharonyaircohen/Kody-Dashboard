/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern company-workflow-detail-api
 * @ai-summary Reads, updates, and deletes workflow definition files in the
 *   configured Kody state repo.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
  verifyActorLogin,
} from "@dashboard/lib/auth";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import {
  getEngineConfig,
  writeConfigPatch,
} from "@dashboard/lib/engine/config";
import {
  isWorkflowDefinitionId,
  mergeWorkflowDefinition,
  workflowDefinitionPath,
} from "@dashboard/lib/workflow-definitions";
import {
  deleteWorkflowDefinitionFile,
  readCompanyStoreWorkflowDefinitionFile,
  readWorkflowDefinitionFile,
  writeWorkflowDefinitionFile,
} from "@dashboard/lib/workflow-definition-files";

const workflowPatchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  instructions: z.string().trim().min(1).max(5000).optional(),
  capabilities: z.array(z.string().trim().min(1).max(80)).min(1).optional(),
  actorLogin: z.string().trim().optional(),
});

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

async function getContext(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  setGitHubContext(
    headerAuth.owner,
    headerAuth.repo,
    headerAuth.token,
    headerAuth.storeRepoUrl,
    headerAuth.storeRef,
  );
  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "no_user_token" }, { status: 401 });
  }

  return { headerAuth, octokit };
}

async function activeWorkflowSet(
  octokit: NonNullable<Awaited<ReturnType<typeof getUserOctokit>>>,
  owner: string,
  repo: string,
): Promise<Set<string>> {
  const { config } = await getEngineConfig(octokit, owner, repo, {
    force: true,
  });
  return new Set(config.company?.activeWorkflows ?? []);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await getContext(req);
    if (context instanceof NextResponse) return context;

    const { id } = await params;
    if (!isWorkflowDefinitionId(id)) {
      return NextResponse.json(
        { error: "invalid_workflow_id" },
        { status: 400 },
      );
    }

    const existing = await readWorkflowDefinitionFile(
      id,
      context.octokit,
      context.headerAuth.owner,
      context.headerAuth.repo,
    );
    if (!existing) {
      const active = await activeWorkflowSet(
        context.octokit,
        context.headerAuth.owner,
        context.headerAuth.repo,
      );
      if (active.has(id)) {
        const storeWorkflow = await readCompanyStoreWorkflowDefinitionFile(
          id,
          context.octokit,
        );
        if (storeWorkflow) {
          return NextResponse.json({ workflow: storeWorkflow });
        }
      }
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({
      workflow: {
        id,
        path: existing.path,
        workflow: existing.workflow,
        updatedAt: existing.workflow.updatedAt,
        source: "local",
        readOnly: false,
      },
    });
  } catch (err: any) {
    return mapGithubError(err, "failed_to_read_workflow");
  } finally {
    clearGitHubContext();
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await getContext(req);
    if (context instanceof NextResponse) return context;

    const { id } = await params;
    if (!isWorkflowDefinitionId(id)) {
      return NextResponse.json(
        { error: "invalid_workflow_id" },
        { status: 400 },
      );
    }

    const payload = await req.json().catch(() => null);
    const parsed = workflowPatchSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const actorResult = await verifyActorLogin(req, parsed.data.actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    workflowDefinitionPath(id);
    const existing = await readWorkflowDefinitionFile(
      id,
      context.octokit,
      context.headerAuth.owner,
      context.headerAuth.repo,
    );
    if (!existing) {
      const storeWorkflow = await readCompanyStoreWorkflowDefinitionFile(
        id,
        context.octokit,
      );
      if (storeWorkflow) {
        return NextResponse.json(
          {
            error: "store_workflow_protected",
            message: "Store workflows cannot be edited from this repo.",
          },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const workflow = mergeWorkflowDefinition(existing.workflow, parsed.data);
    if (workflow.capabilities.length === 0) {
      return NextResponse.json(
        {
          error: "invalid_body",
          message: "Workflow needs at least one capability.",
        },
        { status: 400 },
      );
    }

    await writeWorkflowDefinitionFile({
      octokit: context.octokit,
      owner: context.headerAuth.owner,
      repo: context.headerAuth.repo,
      id,
      workflow,
      sha: existing.sha,
      message: `chore(workflows): update workflow ${id}`,
    });

    return NextResponse.json({
      workflow: {
        id,
        path: existing.path,
        workflow,
        updatedAt: workflow.updatedAt,
      },
    });
  } catch (err: any) {
    return mapGithubError(err, "failed_to_update_workflow");
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
    if (!isWorkflowDefinitionId(id)) {
      return NextResponse.json(
        { error: "invalid_workflow_id" },
        { status: 400 },
      );
    }

    const actorResult = await verifyActorLogin(req, undefined);
    if (actorResult instanceof NextResponse) return actorResult;

    const existing = await readWorkflowDefinitionFile(
      id,
      context.octokit,
      context.headerAuth.owner,
      context.headerAuth.repo,
    );
    if (!existing) {
      const active = await activeWorkflowSet(
        context.octokit,
        context.headerAuth.owner,
        context.headerAuth.repo,
      );
      if (!active.has(id)) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      const nextActiveWorkflows = [...active].filter((slug) => slug !== id);
      await writeConfigPatch(
        context.octokit,
        context.headerAuth.owner,
        context.headerAuth.repo,
        {
          activeWorkflows:
            nextActiveWorkflows.length > 0 ? nextActiveWorkflows : null,
        },
        `chore(workflows): remove store workflow ${id}`,
      );
      return NextResponse.json({
        success: true,
        removedStoreReference: true,
      });
    }

    await deleteWorkflowDefinitionFile({
      octokit: context.octokit,
      owner: context.headerAuth.owner,
      repo: context.headerAuth.repo,
      id,
      sha: existing.sha,
      message: `chore(workflows): delete workflow ${id}`,
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return mapGithubError(err, "failed_to_delete_workflow");
  } finally {
    clearGitHubContext();
  }
}
