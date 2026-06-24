/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern agentResponsibility-run
 * @ai-summary POST /api/kody/agent-responsibilities/:slug/run — manually trigger a single
 *   agentResponsibility by dispatching `.github/workflows/kody.yml` with the agentResponsibility-owned
 *   public action name. The workflow input is still named `agentAction` for
 *   GitHub Actions compatibility; the engine resolves that value as a agentResponsibility
 *   action before lowering to the implementation agentAction.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import { isValidSlug, readResolvedAgentResponsibilityFile } from "@dashboard/lib/agent-responsibilities-files";
import {
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import { recordAudit } from "@dashboard/lib/activity/audit";
import { buildKodyWorkflowDispatchInputs } from "@dashboard/lib/kody-workflow-dispatch";

const runSchema = z.object({
  force: z.boolean().optional().default(true),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;

  const { slug } = await params;
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  }

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  const { owner, repo } = headerAuth;

  let payload: { force: boolean };
  setGitHubContext(owner, repo, headerAuth.token);
  try {
    const raw =
      req.headers.get("content-length") === "0"
        ? {}
        : await req.json().catch(() => ({}));
    payload = runSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: err.issues },
        { status: 400 },
      );
    }
    payload = { force: true };
  }

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json(
      {
        error: "no_user_token",
        message:
          "A signed-in GitHub token is required to dispatch the workflow.",
      },
      { status: 401 },
    );
  }

  try {
    const agentResponsibility = await readResolvedAgentResponsibilityFile(slug, octokit);
    if (!agentResponsibility) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const action = agentResponsibility.action ?? slug;
    const repoMeta = await octokit.rest.repos.get({
      owner,
      repo,
    });
    const ref = repoMeta.data.default_branch || "main";
    const inputs = await buildKodyWorkflowDispatchInputs(octokit, {
      owner,
      repo,
      ref,
      action,
    });
    await octokit.rest.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: "kody.yml",
      ref,
      inputs,
    });
    recordAudit(req, {
      action: "agentResponsibility.run",
      resource: slug,
      agentResponsibility: slug,
      detail: payload.force
        ? `manual workflow dispatch for @kody ${action} (force)`
        : `manual workflow dispatch for @kody ${action}`,
    });
    return NextResponse.json({
      ok: true,
      workflowId: "kody.yml",
      ref,
      action,
      agentResponsibility: slug,
      force: payload.force,
    });
  } catch (err: any) {
    console.error("[agentResponsibilities/run] dispatch failed", err);
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
