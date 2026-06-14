/**
 * @fileType utility
 * @domain kody
 * @pattern squash-merge
 * @ai-summary Shared squash-merge helper. Extracted from the approve-gate
 *   route so every code path that merges a PR (the human approve gate AND the
 *   CTO/QA `merge` approve-action) classifies merge failures identically —
 *   CI-blocked, conflict, already-merged, or other — instead of duplicating
 *   the octokit call + error taxonomy. Pure-ish: one octokit call, no other
 *   side effects (branch delete / issue close stay with the caller).
 */
import type { Octokit } from "@octokit/rest";
import { getOwner, getRepo } from "@dashboard/lib/github-client";

export type MergeOutcome =
  | { kind: "merged" }
  | { kind: "already-merged" }
  | { kind: "failed-ci" }
  | { kind: "failed-conflict" }
  | { kind: "failed-other"; message: string; status?: number };

/** True when the PR is now merged (freshly or already). */
export function isMerged(outcome: MergeOutcome): boolean {
  return outcome.kind === "merged" || outcome.kind === "already-merged";
}

export async function attemptSquashMerge(
  octokit: Octokit,
  prNumber: number,
): Promise<MergeOutcome> {
  try {
    await octokit.pulls.merge({
      owner: getOwner(),
      repo: getRepo(),
      pull_number: prNumber,
      merge_method: "squash",
    });
    return { kind: "merged" };
  } catch (err) {
    const e = err as { status?: number; message?: string };
    const msg = e.message ?? "";
    // GitHub returns 405 for non-mergeable (CI failing, branch protection,
    // mergeable_state is "blocked" / "behind" / "dirty"). 422 for conflicts.
    // Classify so the caller (and the dashboard UI) can show the right
    // message instead of a generic 500.
    if (msg.includes("already merged") || msg.includes("Already up to date")) {
      return { kind: "already-merged" };
    }
    if (msg.includes("not mergeable") || e.status === 405) {
      return { kind: "failed-ci" };
    }
    if (e.status === 409 || /conflict/i.test(msg)) {
      return { kind: "failed-conflict" };
    }
    return { kind: "failed-other", message: msg, status: e.status };
  }
}
