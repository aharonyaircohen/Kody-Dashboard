/**
 * @fileType utility
 * @domain kody
 * @pattern kody-command-post
 * @ai-summary Shared helper for posting a Kody command/comment on an issue
 *   with user-token-first, bot-token-fallback semantics. Extracted from the
 *   tasks actions route so other callers (e.g. the CTO decision endpoint)
 *   can trigger the same `@kody` execution path without duplicating the
 *   auth-fallback logic or growing the actions route into a god-module.
 */
import type { Octokit } from "@octokit/rest";
import { postComment } from "./github-client";

/** Append a `(by @actor)` attribution suffix when posting via the bot token. */
export function withActor(message: string, actor?: string): string {
  return actor ? `${message} _(by @${actor})_` : message;
}

/**
 * Post a comment on an issue, preferring the user's token (clean
 * attribution) and falling back to the bot token (with attribution) only
 * on a GitHub auth failure. Non-auth errors propagate.
 */
export async function postWithFallback(
  issueNumber: number,
  message: string,
  actor: string | undefined,
  userOctokit?: Octokit | null,
): Promise<void> {
  if (!userOctokit) {
    await postComment(issueNumber, withActor(message, actor));
    return;
  }

  try {
    await postComment(issueNumber, message, userOctokit);
  } catch (error: unknown) {
    const err = error as {
      status?: number;
      message?: string;
      response?: { data?: { message?: string } };
    };
    const isAuthError = err?.status === 401 || err?.status === 403;
    const isGitHubAuthError =
      isAuthError &&
      (err?.message?.includes("Bad credentials") ||
        err?.message?.includes("Resource not found") ||
        err?.message?.includes("Not Found") ||
        err?.response?.data?.message?.includes("Bad credentials") ||
        err?.response?.data?.message?.includes("Not Found"));

    if (isAuthError || isGitHubAuthError) {
      console.warn(
        `[Kody] User token failed (status: ${err?.status}), falling back to bot token for issue ${issueNumber}`,
      );
      await postComment(issueNumber, withActor(message, actor));
    } else {
      throw error;
    }
  }
}
