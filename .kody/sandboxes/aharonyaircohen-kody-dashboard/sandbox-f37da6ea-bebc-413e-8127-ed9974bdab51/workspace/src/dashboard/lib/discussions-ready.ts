/**
 * @fileType lib
 * @domain kody
 * @pattern discussions-ready
 * @ai-summary Shared "is the repo able to host Discussions, and which
 *   category do we file under" probe. Auto-enables Discussions with the
 *   user's PAT when off. Used by the messaging-channels API (and mirrors
 *   the inline helper in the goal-discussion route).
 */
import type { Octokit } from "@octokit/rest";
import {
  fetchRepoDiscussionMeta,
  enableRepoDiscussions,
} from "@dashboard/lib/github-client";

export type DiscussionsReadyOutcome =
  | { ok: true; categoryId: string }
  | { ok: false; reason: "discussions_disabled"; message: string }
  | { ok: false; reason: "category_missing"; message: string };

/**
 * Ensure Discussions are enabled and a category exists. Takes the user's
 * Octokit (may be null) so the auto-enable PATCH is attributed to the human
 * — never the shared polling token.
 */
export async function ensureDiscussionsReady(
  userOctokit: Octokit | null,
): Promise<DiscussionsReadyOutcome> {
  let meta = await fetchRepoDiscussionMeta();

  if (!meta.enabled) {
    if (!userOctokit) {
      return {
        ok: false,
        reason: "discussions_disabled",
        message:
          "Discussions are off and the dashboard could not enable them automatically (no user token).",
      };
    }
    const result = await enableRepoDiscussions(userOctokit);
    if (!result.ok) {
      return {
        ok: false,
        reason: "discussions_disabled",
        message:
          result.reason === "forbidden"
            ? "Discussions are off and could not be enabled — repo admin permission required."
            : `Could not enable Discussions: ${result.message ?? "unknown error"}`,
      };
    }
    meta = await fetchRepoDiscussionMeta();
  }

  if (!meta.categoryId) {
    return {
      ok: false,
      reason: "category_missing",
      message:
        "No discussion categories are available. Recreate at least one category in your repo Discussions tab.",
    };
  }
  return { ok: true, categoryId: meta.categoryId };
}
