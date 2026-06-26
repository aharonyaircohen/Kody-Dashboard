/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern company-workflows-api
 * @ai-summary Lists and creates workflow definitions in the configured Kody
 *   state repo without touching the GitHub Actions workflow-runs endpoint.
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
import { getEngineConfig, type KodyConfig } from "@dashboard/lib/engine/config";
import {
  buildWorkflowDefinition,
  slugifyWorkflowDefinitionId,
  workflowDefinitionPath,
} from "@dashboard/lib/workflow-definitions";
import {
  listCompanyStoreWorkflowDefinitionFiles,
  listWorkflowDefinitionFiles,
  readWorkflowDefinitionFile,
  writeWorkflowDefinitionFile,
} from "@dashboard/lib/workflow-definition-files";

const workflowPayloadSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(160),
  instructions: z.string().trim().min(1).max(5000),
  capabilities: z.array(z.string().trim().min(1).max(80)).min(1),
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

function activeWorkflowSlugs(config: KodyConfig): string[] {
  return (config.company?.activeWorkflows ?? []).filter(
    (slug): slug is string =>
      typeof slug === "string" && slug.trim().length > 0,
  );
}

export async function GET(req: NextRequest) {
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
  try {
    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }

    const localWorkflows = await listWorkflowDefinitionFiles(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    const { config } = await getEngineConfig(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    const activeWorkflowIds = new Set(activeWorkflowSlugs(config));
    const localIds = new Set(localWorkflows.map((workflow) => workflow.id));
    const storeWorkflows =
      activeWorkflowIds.size > 0
        ? (await listCompanyStoreWorkflowDefinitionFiles(octokit)).filter(
            (workflow) =>
              activeWorkflowIds.has(workflow.id) && !localIds.has(workflow.id),
          )
        : [];
    const workflows = [...localWorkflows, ...storeWorkflows].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    return NextResponse.json(
      { workflows },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return mapGithubError(err, "failed_to_list_workflows");
  } finally {
    clearGitHubContext();
  }
}

export async function POST(req: NextRequest) {
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
  try {
    const payload = await req.json().catch(() => null);
    const parsed = workflowPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const actorResult = await verifyActorLogin(req, parsed.data.actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }

    const id =
      slugifyWorkflowDefinitionId(parsed.data.id ?? "") ||
      slugifyWorkflowDefinitionId(parsed.data.name);
    if (!id) {
      return NextResponse.json(
        { error: "invalid_workflow_id" },
        { status: 400 },
      );
    }
    workflowDefinitionPath(id);

    const existing = await readWorkflowDefinitionFile(
      id,
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    if (existing) {
      return NextResponse.json(
        {
          error: "workflow_exists",
          message: `Workflow "${id}" already exists.`,
        },
        { status: 409 },
      );
    }

    const workflow = buildWorkflowDefinition(parsed.data);
    if (workflow.capabilities.length === 0) {
      return NextResponse.json(
        {
          error: "invalid_body",
          message: "Workflow needs at least one capability.",
        },
        { status: 400 },
      );
    }
    const path = workflowDefinitionPath(id);
    await writeWorkflowDefinitionFile({
      octokit,
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      id,
      workflow,
      message: `chore(workflows): create workflow ${id}`,
    });

    return NextResponse.json({ workflow: { id, path, workflow } });
  } catch (err: any) {
    return mapGithubError(err, "failed_to_create_workflow");
  } finally {
    clearGitHubContext();
  }
}
