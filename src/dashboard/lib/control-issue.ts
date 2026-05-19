/**
 * @fileType util
 * @domain kody
 * @pattern control-issue
 * @ai-summary Shared helper for the repo's single "Kody control" issue —
 *   the audit-trail issue the dashboard posts `@kody <subcommand>` comments
 *   on to manually dispatch engine executables (the engine fires on
 *   `issue_comment` and routes to the named executable). Used by Job
 *   "Run now" and by worker @mentions ("ask"); both reuse the same issue
 *   so the dispatch trail lives in one place.
 */

import type { Octokit } from "@octokit/rest";
import { INTERNAL_ISSUE_LABEL } from "./constants";

const CONTROL_LABEL = "kody:control";
const CONTROL_TITLE = "Kody control";
const CONTROL_BODY = [
  "Audit trail for manual `@kody` dispatches from the dashboard.",
  "",
  'Each comment below was a manual dispatch (Job "Run now", or a worker',
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
