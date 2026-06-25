/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern interactive-session-start
 *
 * POST /api/kody/chat/interactive/start
 *
 * Starts a long-lived "interactive runner" chat session. Writes the meta
 * line to the state repo's `sessions/{sessionId}.jsonl` (no user turn yet)
 * and dispatches `kody.yml`. The runner detects the meta line, enters its
 * poll loop, and emits `chat.ready` to signal the dashboard to unlock
 * input. New user messages get appended via /api/kody/chat/interactive/append
 * — they do NOT trigger a fresh workflow dispatch.
 *
 * Body:
 *   { taskId: string;                // sessionId
 *     dashboardUrl?: string;          // base URL; HMAC token appended server-side
 *     idleExitMs?: number;            // optional override (engine default 5min)
 *     hardCapMs?: number;             // optional override (engine default 30min, max 360min)
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";
import {
  buildMetaLine,
  writeSessionMeta,
} from "@dashboard/lib/interactive-session";
import {
  applyVibePrimerToContent,
  type VibeTaskContext,
} from "@dashboard/lib/vibe/primer";
import { resolveFlyContext } from "@dashboard/lib/runners/fly-context";
import { claimOrSpawnFly } from "@dashboard/lib/runners/fly-run";
import { checkGitHubActionsHealth } from "@dashboard/lib/runners/github-health";
import { dispatchRun } from "@dashboard/lib/runners/runner-dispatch";

export const runtime = "nodejs";

function getChatRepoOverride(): { owner: string; repo: string } | undefined {
  const override = (process.env.KODY_CHAT_WORKFLOW_REPO ?? "").trim();
  if (!override || !override.includes("/")) return undefined;
  const [owner, repo] = override.split("/").map((s) => s.trim());
  if (!owner || !repo) return undefined;
  return { owner, repo };
}

function getEngineRepo(req: NextRequest): { owner: string; repo: string } {
  const override = getChatRepoOverride();
  if (override) return override;
  const headerAuth = getRequestAuth(req);
  if (headerAuth) return { owner: headerAuth.owner, repo: headerAuth.repo };
  const { GITHUB_OWNER, GITHUB_REPO } = process.env as Record<string, string>;
  return {
    owner: (GITHUB_OWNER ?? "aharonyaircohen").trim(),
    repo: (GITHUB_REPO ?? "Kody-Dashboard").trim(),
  };
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  let body: {
    taskId?: string;
    idleExitMs?: number;
    hardCapMs?: number;
    content?: string;
    timestamp?: string;
    vibeMode?: boolean;
    taskContext?: VibeTaskContext;
    /**
     * Thinking level for the engine (off|low|medium|high). Forwarded as
     * a workflow input to kody.yml which sets the REASONING_EFFORT env
     * var the engine reads. When unset, the engine uses its own
     * default (off = no thinking = cheapest path).
     */
    reasoningEffort?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    taskId,
    idleExitMs,
    hardCapMs,
    content,
    vibeMode,
    taskContext,
    reasoningEffort,
  } = body;
  if (!taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  const { owner, repo } = getEngineRepo(req);
  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json(
      { error: "No GitHub token available" },
      { status: 503 },
    );
  }

  try {
    logger.info(
      { taskId, owner, repo, idleExitMs, hardCapMs },
      "interactive: starting session",
    );

    const meta = buildMetaLine({ idleExitMs, hardCapMs });
    // If the caller supplied the first user turn (the vibe auto-kickoff, or a
    // first message typed before the runner is up), write it INTO the same
    // commit as the meta line. Doing it here — instead of a follow-up
    // /interactive/append — removes the start-vs-append write race that was
    // dropping the kickoff turn and leaving the runner with nothing to do.
    const initialTurn =
      content && content.trim().length > 0
        ? {
            role: "user" as const,
            content: vibeMode
              ? applyVibePrimerToContent(content, taskContext)
              : content,
            timestamp: body.timestamp ?? new Date().toISOString(),
          }
        : undefined;
    await writeSessionMeta(
      octokit,
      owner,
      repo,
      taskId,
      meta,
      undefined,
      undefined,
      initialTurn,
    );

    // No dashboardUrl: the engine HttpSink would push events to /ingest in
    // real time, but Vercel's per-instance in-memory bus means the push
    // often misses the client's poll handler. Falling back to plain client
    // polling (every 3s with ETag caching) is simpler and reliable.
    // Forward the user's thinking level (if any) so the engine's chat
    // turn respects the chat-level pick. Empty string lets the engine
    // fall back to its own default (off).
    const workflowInputs: Record<string, string> = {
      sessionId: taskId,
      ...(typeof reasoningEffort === "string" &&
      reasoningEffort.trim().length > 0
        ? { reasoningEffort: reasoningEffort.trim() }
        : {}),
    };

    // GitHub is the base runner; Fly is the fallback when GitHub Actions is
    // degraded or its queue is backed up (proactive), or when the dispatch
    // call itself throws (reactive). Resolve the Fly context up front so the
    // fallback has everything it needs — flyAvailable is false when the repo
    // has no FLY_API_TOKEN, in which case we just stay on GitHub.
    const flyCtx = await resolveFlyContext(req, {
      repoOverride: getChatRepoOverride(),
    }).catch(() => null);
    const flyContext =
      flyCtx && flyCtx.ok && flyCtx.context.flyToken
        ? flyCtx.context
        : undefined;
    const flyAvailable = !!flyContext;

    const outcome = await dispatchRun({
      flyAvailable,
      checkHealth: () =>
        checkGitHubActionsHealth({
          countQueuedRuns: async () => {
            const res = await octokit.actions.listWorkflowRuns({
              owner,
              repo,
              workflow_id: "kody.yml",
              status: "queued",
              per_page: 1,
            });
            return res.data.total_count ?? 0;
          },
        }),
      dispatchGitHub: () =>
        octokit.actions
          .createWorkflowDispatch({
            owner,
            repo,
            workflow_id: "kody.yml",
            ref: "main",
            inputs: workflowInputs,
          })
          .then(() => undefined),
      runFly: () =>
        claimOrSpawnFly(flyCtx!.ok ? flyCtx!.context : (null as never), {
          taskId,
          idleExitMs,
          hardCapMs,
          ...(typeof reasoningEffort === "string" &&
          reasoningEffort.trim().length > 0
            ? { reasoningEffort: reasoningEffort.trim() }
            : {}),
        }),
    });

    logger.info(
      { taskId, owner, repo, runner: outcome.runner, reason: outcome.reason },
      "interactive: session started",
    );
    return NextResponse.json({
      ok: true,
      taskId,
      mode: "interactive",
      runner: outcome.runner,
      reason: outcome.reason,
      ...(outcome.fellBackOnError ? { fellBackOnError: true } : {}),
      ...(outcome.flyResult ? { machineId: outcome.flyResult.machineId } : {}),
      target:
        outcome.runner === "github"
          ? { owner, repo, branch: "main", workflow: "kody.yml" }
          : { owner, repo, branch: "main", workflow: "fly" },
    });
  } catch (err) {
    logger.error({ err, taskId }, "interactive: start failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Start failed" },
      { status: 500 },
    );
  }
}
