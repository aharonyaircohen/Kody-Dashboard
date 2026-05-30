/**
 * @fileType library
 * @domain previews
 * @pattern dispatch-router
 *
 * Pick where a per-PR preview build runs:
 *
 *   - GitHub Actions (kody.yml, executable=preview-build) when GH is
 *     healthy and not back-logged. Builds run in parallel on free GHA
 *     runners.
 *   - Fly Machines (existing builder image) when GH is degraded,
 *     queue-full, or the dispatch call itself fails.
 *
 * Reuses the existing dispatchRun orchestrator (runners/runner-dispatch)
 * so the decision shape, fail-over semantics, and health probe are
 * shared with the engine-runner routing — one source of truth for
 * "GitHub base, Fly fallback".
 */

import { Octokit } from "@octokit/rest";

import { resolveBackgroundToken } from "@dashboard/lib/auth/background-token";
import { logger } from "@dashboard/lib/logger";
import { createPreview } from "@dashboard/lib/previews/preview-lifecycle";
import { previewAppName } from "@dashboard/lib/previews/preview-key";
import { resolvePreviewConfigForRepo } from "@dashboard/lib/previews/config";
import {
  checkGitHubActionsHealth,
  type GitHubActionsHealth,
} from "@dashboard/lib/runners/github-health";
import { dispatchRun } from "@dashboard/lib/runners/runner-dispatch";

/** Default workflow file the consumer's kody-engine workflow lives at. */
const DEFAULT_WORKFLOW = process.env.KODY_CHAT_WORKFLOW_ID ?? "kody.yml";

export interface RoutePreviewBuildInput {
  /** owner/name */
  repoFullName: string;
  prNumber: number;
  /** Head SHA the engine should checkout. Passed through as the `ref`
   *  workflow_dispatch input so kody-engine knows what to build. */
  ref: string;
}

export interface RoutePreviewBuildOutcome {
  runner: "github" | "fly";
  reason: string;
  /** Set when the run actually started on Fly (deterministic URL,
   *  builder machine id, etc.). */
  flyAppName?: string;
  flyUrl?: string;
}

/**
 * Workflow inputs the existing kody.yml ALREADY declares. The engine's
 * dispatch.ts binds `issue_number` to the resolved executable's
 * primary numeric input — for the `preview-build` profile that's
 * `pr`, so `ctx.args.pr` ends up = the PR number. Reusing the
 * declared schema means no kody.yml edits in any consumer repo.
 */
interface PreviewBuildWorkflowInputs {
  executable: "preview-build";
  issue_number: string;
}

async function countQueuedRunsForRepo(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<number> {
  try {
    const { data } = await octokit.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      status: "queued",
      per_page: 100,
    });
    return data.total_count ?? data.workflow_runs?.length ?? 0;
  } catch (err) {
    logger.warn(
      { err, owner, repo },
      "previews.router: queued-runs count failed (treated as 0)",
    );
    return 0;
  }
}

async function dispatchWorkflowDispatch(
  octokit: Octokit,
  owner: string,
  repo: string,
  workflowId: string,
  inputs: PreviewBuildWorkflowInputs,
): Promise<void> {
  await octokit.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id: workflowId,
    ref: "main",
    inputs: { ...inputs },
  });
}

/**
 * Decide where the build runs and start it. Returns where it landed
 * and why, so the caller can log + surface in the dashboard if
 * needed. Throws only when both paths are unavailable.
 */
export async function routePreviewBuild(
  input: RoutePreviewBuildInput,
  opts: {
    /** Test seam — override the workflow file name (default `kody.yml`). */
    workflowId?: string;
  } = {},
): Promise<RoutePreviewBuildOutcome> {
  const [owner, repo] = input.repoFullName.split("/") as [string, string];
  if (!owner || !repo) {
    throw new Error(`invalid repo "${input.repoFullName}"`);
  }

  // Resolve background token + Fly config once. Both arms may need
  // them (the GH arm needs the token to dispatch; the Fly arm needs
  // both for the existing createPreview path).
  const bg = await resolveBackgroundToken(owner, repo);
  if (!bg) {
    throw new Error(
      `previews.router: no background token for ${input.repoFullName}`,
    );
  }
  const octokit = new Octokit({ auth: bg.token });
  const cfg = await resolvePreviewConfigForRepo(owner, repo);
  const flyAvailable = cfg !== null;
  const workflowId = opts.workflowId ?? DEFAULT_WORKFLOW;

  const outcome = await dispatchRun({
    checkHealth: () =>
      checkGitHubActionsHealth({
        countQueuedRuns: () => countQueuedRunsForRepo(octokit, owner, repo),
      }),
    flyAvailable,
    dispatchGitHub: () =>
      dispatchWorkflowDispatch(octokit, owner, repo, workflowId, {
        executable: "preview-build",
        issue_number: String(input.prNumber),
      }),
    runFly: async () => {
      // The Fly arm shape `dispatchRun` expects is `{ runner, machineId }` —
      // preview-lifecycle returns a richer object. Adapt at the boundary.
      if (!cfg) throw new Error("fly fallback selected but no Fly config");
      const info = await createPreview(
        {
          repo: input.repoFullName,
          pr: input.prNumber,
          ref: input.ref,
          githubToken: bg.token,
        },
        cfg,
      );
      return {
        runner: "fly" as const,
        machineId: info.builderMachineId ?? "",
      };
    },
  });

  logger.info(
    {
      repo: input.repoFullName,
      pr: input.prNumber,
      runner: outcome.runner,
      reason: outcome.reason,
      fellBackOnError: outcome.fellBackOnError ?? false,
    },
    "previews.router: build dispatched",
  );

  if (outcome.runner === "fly") {
    const appName = previewAppName({
      repo: input.repoFullName,
      pr: input.prNumber,
    });
    return {
      runner: "fly",
      reason: outcome.reason,
      flyAppName: appName,
      flyUrl: `https://${appName}.fly.dev`,
    };
  }
  return { runner: "github", reason: outcome.reason };
}

/** Re-exported so consumers don't need to thread through both modules. */
export type { GitHubActionsHealth };
