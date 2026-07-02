/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern company-intent-run
 * @ai-summary Dispatches the CTO agency-architect action for an intent review now.
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
import { recordAudit } from "@dashboard/lib/activity/audit";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { buildKodyWorkflowDispatchInputs } from "@dashboard/lib/kody-workflow-dispatch";
import {
  companyIntentPath,
  isCompanyIntentId,
} from "@dashboard/lib/company-intents";
import { readStateText } from "@dashboard/lib/state-repo";

const runSchema = z.object({
  actorLogin: z.string().trim().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;
  if (!isCompanyIntentId(id)) {
    return NextResponse.json({ error: "invalid_intent_id" }, { status: 400 });
  }

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const payload =
      req.headers.get("content-length") === "0"
        ? {}
        : await req.json().catch(() => ({}));
    const parsed = runSchema.safeParse(payload);
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

    const existing = await readStateText(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
      companyIntentPath(id),
    );
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const repoMeta = await octokit.rest.repos.get({
      owner: headerAuth.owner,
      repo: headerAuth.repo,
    });
    const ref = repoMeta.data.default_branch || "main";
    const inputs = await buildKodyWorkflowDispatchInputs(octokit, {
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      ref,
      action: "agency-architect",
      message: `Review company intent ${id}`,
    });

    await octokit.rest.actions.createWorkflowDispatch({
      owner: headerAuth.owner,
      repo: headerAuth.repo,
      workflow_id: "kody.yml",
      ref,
      inputs,
    });

    recordAudit(req, {
      action: "companyIntent.run",
      resource: id,
      detail: `manual workflow dispatch for agency-architect intent ${id}`,
    });

    return NextResponse.json({
      ok: true,
      workflowId: "kody.yml",
      ref,
      action: "agency-architect",
      intentId: id,
    });
  } catch (err: any) {
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
