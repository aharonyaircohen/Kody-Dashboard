/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern task-start-api
 * @ai-summary POST /api/kody/tasks/:taskId/start — start a task through the
 *   server-owned command path instead of letting the browser compose GitHub
 *   label/comment actions.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  requireKodyAuth,
  verifyActorLogin,
  getRequestAuth,
} from "@dashboard/lib/auth";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { recordAudit } from "@dashboard/lib/activity/audit";
import { startKodyTask } from "@dashboard/lib/tasks/start-task";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
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
    const { taskId } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      actorLogin?: string;
    };

    const actorResult = await verifyActorLogin(req, body.actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;
    const actor = actorResult.identity.login;

    recordAudit(req, {
      action: "task.start",
      resource: taskId,
      detail: "server-command",
    });

    const result = await startKodyTask(taskId, actor);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to start task";
    console.error("[Kody] Error starting task:", error);
    return NextResponse.json(
      { error: "task_start_failed", message },
      { status: message === "Invalid task ID" ? 400 : 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
