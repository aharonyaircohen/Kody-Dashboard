/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern vibe-execute
 *
 * POST /api/kody/vibe/execute
 *
 * Spawns a Fly Machine that runs the engine in agent mode (run-executable)
 * against a specific issue. The engine reads ISSUE_NUMBER from env (via
 * runner/entrypoint.sh translating it to `kody run --issue N`), then
 * branches, codes, commits, and opens a PR — using the issue body as the
 * already-finalized plan.
 *
 * Distinct from /api/kody/tasks/[id]/actions { action: "execute" }, which
 * posts `@kody` on the issue and runs full orchestration (classify →
 * plan → review → run) on GitHub Actions. That path is for the kanban
 * Dashboard. Vibe explicitly skips orchestration because the plan is
 * already in the issue body — the only step left is implementation.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireKodyAuth } from "@dashboard/lib/auth";
import { logger } from "@dashboard/lib/logger";
import { spawnRunner } from "@dashboard/lib/runners/fly";
import { resolveFlyContext } from "@dashboard/lib/runners/fly-context";
import { claimFromPool } from "@dashboard/lib/runners/pool-client";

export const runtime = "nodejs";

/** Ceiling on the default-branch lookup; on timeout the runner falls back to main. */
const BRANCH_LOOKUP_TIMEOUT_MS = 5_000;

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  let body: { issueNumber?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const issueNumber = Number(body.issueNumber);
  if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
    return NextResponse.json(
      { error: "issueNumber (positive integer) required" },
      { status: 400 },
    );
  }

  const ctxResult = await resolveFlyContext(req);
  if (!ctxResult.ok) {
    return NextResponse.json(
      { error: ctxResult.error },
      { status: ctxResult.status },
    );
  }
  const { owner, repo, githubToken, octokit, allSecrets, flyToken, perfTier } =
    ctxResult.context;

  // sessionId is traceable but unused by the engine in agent mode —
  // entry.ts only consults SESSION_ID when argv is empty, and our
  // entrypoint passes `run --issue N` argv. Timestamp suffix keeps each
  // click distinguishable in logs even when the same issue is re-run.
  const sessionId = `vibe-issue-${issueNumber}-${Date.now()}`;

  // Clone the repo's actual default branch, not the runner's hardcoded
  // "main" fallback. Repos using "dev" or "develop" as default would
  // otherwise get a stale main checkout and the agent's PR would diverge
  // from the active line of development.
  let ref: string | undefined;
  try {
    const { data } = await octokit.repos.get({
      owner,
      repo,
      // Bound the lookup: a hung GitHub call must not hold the spawn open.
      // On timeout this throws, we log, and the runner falls back to main
      // (the existing graceful-degradation path below).
      request: { signal: AbortSignal.timeout(BRANCH_LOOKUP_TIMEOUT_MS) },
    });
    ref = data.default_branch;
  } catch (err) {
    logger.warn(
      { err, owner, repo },
      "vibe-execute: default-branch lookup failed; runner will fall back to main",
    );
  }

  try {
    const claim = await claimFromPool({
      jobId: sessionId,
      repo: `${owner}/${repo}`,
      issueNumber,
      ref,
      sessionId,
    });
    if (claim.ok) {
      logger.info(
        { issueNumber, machineId: claim.machineId, owner, repo, sessionId },
        "vibe-execute: claimed warm pool machine",
      );
      return NextResponse.json({
        ok: true,
        issueNumber,
        runner: "pool",
        machineId: claim.machineId,
        sessionId,
      });
    }

    logger.info(
      { issueNumber, owner, repo, sessionId, ref, poolMiss: claim.reason },
      "vibe-execute: pool miss — spawning fresh runner",
    );

    const { machineId, region } = await spawnRunner({
      repo: `${owner}/${repo}`,
      githubToken,
      sessionId,
      issueNumber,
      ref,
      allSecrets,
      flyToken,
      perfTier,
    });

    logger.info(
      { issueNumber, machineId, region, owner, repo },
      "vibe-execute: machine spawned",
    );

    return NextResponse.json({
      ok: true,
      issueNumber,
      runner: "fly",
      machineId,
      sessionId,
    });
  } catch (err) {
    logger.error({ err, issueNumber }, "vibe-execute: spawn failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Spawn failed" },
      { status: 500 },
    );
  }
}
