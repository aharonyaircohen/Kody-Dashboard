/**
 * @fileType library
 * @domain previews
 * @pattern dispatch-router
 * @ai-summary Decides whether the per-PR preview build runs on Fly (the
 *   prebuilt builder image) or on GitHub Actions (consumer's kody.yml).
 *   Trap: this INVERTS the engine-runner policy on purpose — engine *jobs*
 *   stay GitHub-first, but previews are Fly-first because the GitHub path
 *   was crashing ~half of preview builds with transient `ECONNRESET` on
 *   the `npx kody-engine@latest` download. If you change this to
 *   GitHub-first, expect a re-emergence of "preview URL never resolves"
 *   failures.
 *
 * Pick where a per-PR preview build runs. Previews PREFER Fly:
 *
 *   - Fly Machines (the prebuilt builder image) whenever the repo has a
 *     Fly token. The builder clones + `flyctl deploy`s directly, so it
 *     never runs the `npx kody-engine@latest` download the GitHub path
 *     does on every build — that download was crashing ~half of preview
 *     builds with transient ECONNRESET and leaving no app (so the
 *     `*.fly.dev` hostname never resolved).
 *   - GitHub Actions (kody.yml, capability=preview-build) only as the
 *     fallback — when the repo has no Fly token, or the Fly arm errors.
 *
 * NOTE: this inverts the engine-runner policy on purpose. Engine *jobs*
 * stay GitHub-first via dispatchRun ("GitHub base, Fly fallback"); only
 * previews prefer Fly, because the Fly builder is the reliable,
 * download-free path for them.
 */

import { Octokit } from "@octokit/rest";

import { resolveBackgroundToken } from "@dashboard/lib/auth/background-token";
import { logger } from "@dashboard/lib/logger";
import { createPreview } from "@dashboard/lib/previews/preview-lifecycle";
import { previewAppName } from "@dashboard/lib/previews/preview-key";
import { resolvePreviewConfigForRepo } from "@dashboard/lib/previews/config";
import type { GitHubActionsHealth } from "@dashboard/lib/runners/github-health";

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
 * dispatch.ts binds `issue_number` to the resolved implementation's
 * primary numeric input — for the `preview-build` profile that's
 * `pr`, so `ctx.args.pr` ends up = the PR number. Reusing the
 * declared schema means no kody.yml edits in any consumer repo.
 */
interface PreviewBuildWorkflowInputs {
  implementation: "preview-build";
  issue_number: string;
}

async function dispatchWorkflowDispatch(
  octokit: Octokit,
  owner: string,
  repo: string,
  workflowId: string,
  inputs: PreviewBuildWorkflowInputs,
): Promise<void> {
  // `ref` must be a branch where the workflow file lives. We can't
  // hardcode "main" — A-Guy's default is "dev", other consumers vary.
  // Ask GitHub for the actual default branch (cheap, cached upstream).
  const { data: repoMeta } = await octokit.repos.get({ owner, repo });
  const ref = repoMeta.default_branch || "main";
  await octokit.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id: workflowId,
    ref,
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
  const workflowId = opts.workflowId ?? DEFAULT_WORKFLOW;

  // Fly preferred: when the repo has a Fly token, build on the prebuilt
  // builder image — the reliable, download-free path. Only fall back to
  // GitHub Actions when there's no Fly token, or the Fly arm itself errors.
  if (cfg) {
    try {
      const info = await createPreview(
        {
          repo: input.repoFullName,
          pr: input.prNumber,
          ref: input.ref,
          githubToken: bg.token,
        },
        cfg,
      );
      const appName = previewAppName({
        repo: input.repoFullName,
        pr: input.prNumber,
      });
      logger.info(
        {
          repo: input.repoFullName,
          pr: input.prNumber,
          runner: "fly",
          builderMachineId: info.builderMachineId,
        },
        "previews.router: build dispatched (fly preferred)",
      );
      return {
        runner: "fly",
        reason: "fly preferred (repo has Fly token)",
        flyAppName: appName,
        flyUrl: `https://${appName}.fly.dev`,
      };
    } catch (err) {
      logger.warn(
        { err, repo: input.repoFullName, pr: input.prNumber },
        "previews.router: fly arm failed → falling back to GitHub Actions",
      );
    }
  }

  // No Fly token (or the Fly arm threw) → GitHub Actions runs kody.yml's
  // preview-build implementation.
  await dispatchWorkflowDispatch(octokit, owner, repo, workflowId, {
    implementation: "preview-build",
    issue_number: String(input.prNumber),
  });
  logger.info(
    { repo: input.repoFullName, pr: input.prNumber, runner: "github" },
    "previews.router: build dispatched (github fallback)",
  );
  return {
    runner: "github",
    reason: cfg ? "fly failed → github fallback" : "no Fly token → github",
  };
}

/** Re-exported so consumers don't need to thread through both modules. */
export type { GitHubActionsHealth };
