/**
 * @fileType util
 * @domain kody
 * @pattern control-issue
 * @ai-summary Shared helper for the repo's single "Kody control" issue —
 *   the audit-trail issue the dashboard posts `@kody <subcommand>` comments
 *   on to manually dispatch engine executables (the engine fires on
 *   `issue_comment` and routes to the named executable). Used by Duty
 *   "Run now" and by agent @mentions ("ask"); both reuse the same issue
 *   so the dispatch trail lives in one place.
 */

import type { Octokit } from "@octokit/rest";
import { INTERNAL_ISSUE_LABEL } from "./constants";

const CONTROL_LABEL = "kody:control";
export const CONTROL_TITLE = "Kody control";
const CONTROL_BODY = [
  "Audit trail for manual `@kody` dispatches from the dashboard.",
  "",
  'Each comment below was a manual dispatch (Duty "Run now", or an agent',
  "@mention in a message). The engine fires on `issue_comment` and routes",
  "to the named executable.",
  "",
  "Do not close — the dashboard reuses this issue. If you do close it,",
  "the next dispatch will create a new one.",
].join("\n");

async function ensureControlLabel(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<void> {
  try {
    await octokit.rest.issues.getLabel({ owner, repo, name: CONTROL_LABEL });
  } catch (err: unknown) {
    if ((err as { status?: number })?.status !== 404) throw err;
    await octokit.rest.issues.createLabel({
      owner,
      repo,
      name: CONTROL_LABEL,
      color: "ededed",
      description:
        "Kody manual control issue — audit trail for dashboard dispatches",
    });
  }
}

/**
 * Reuse the most recent open `kody:control` issue, or create one. Idempotent
 * and safe to call from any manual-dispatch path.
 */
export async function findOrCreateControlIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<number> {
  const { data: existing } = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    labels: CONTROL_LABEL,
    state: "open",
    per_page: 1,
  });
  if (existing.length > 0 && existing[0]) return existing[0].number;

  await ensureControlLabel(octokit, owner, repo);

  const { data: created } = await octokit.rest.issues.create({
    owner,
    repo,
    title: CONTROL_TITLE,
    body: CONTROL_BODY,
    // `kody:internal` is the umbrella label every infra issue carries so the
    // task list can exclude them all by one label (GitHub auto-creates it).
    labels: [CONTROL_LABEL, INTERNAL_ISSUE_LABEL],
  });
  return created.number;
}

/** Reply target for an ad-hoc agent run: where the agent posts its answer. */
export interface WorkerAskReply {
  kind: "discussion" | "issue";
  number: number;
}

/**
 * Dispatch a one-shot `agent-ask` tick by posting the directive comment on
 * the repo's control issue. The engine's `issue_comment` trigger fires
 * kody.yml and routes to the `agent-ask` executable. The directive line is
 * first (the engine strips it); the message + context follows verbatim so
 * markdown/newlines survive. Returns the created comment.
 *
 * Shared by the manual HTTP endpoint and the webhook mention path so there
 * is exactly one dispatch shape.
 */
export async function dispatchAgentAsk(
  octokit: Octokit,
  owner: string,
  repo: string,
  opts: { slug: string; message: string; reply?: WorkerAskReply },
): Promise<{ issueNumber: number; commentId: number; commentUrl: string }> {
  const issueNumber = await findOrCreateControlIssue(octokit, owner, repo);
  const replyFlag = opts.reply
    ? ` --thread ${opts.reply.kind}:${opts.reply.number}`
    : "";
  const body = `@kody agent-ask --agent ${opts.slug}${replyFlag}\n\n${opts.message}`;
  const { data: comment } = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
  return {
    issueNumber,
    commentId: comment.id,
    commentUrl: comment.html_url,
  };
}
