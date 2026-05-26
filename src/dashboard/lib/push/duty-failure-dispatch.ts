/**
 * @fileType utility
 * @domain kody
 * @pattern duty-failure-inbox-dispatch
 * @ai-summary Server-only helper that turns a failed duty run into an inbox
 *   entry for every operator — so a silent failure stops being silent.
 *
 *   Why here, not in the engine: a scheduled duty tick is fanned out from
 *   cron with no triggering issue to comment on, and the engine config has
 *   no `operators` list (that lives only in the dashboard's
 *   kody.config.json). So the engine can't @-mention anyone. But it already
 *   reports every tick — including `outcome: "failed"` — into the Company
 *   Activity log (`.kody/activity/<date>.jsonl`, committed to the
 *   `kody-state` branch by `appendCompanyActivity`). That commit fires a
 *   `push` webhook, which is our trigger: read the recent failed records and
 *   append one inbox-feed entry per operator, exactly like
 *   `mention-dispatch.ts` does for `@mentions`. The existing inbox watcher
 *   then syncs each operator's slice into their private gist inbox.
 *
 *   Idempotent: entries carry a deterministic id (`duty-fail:<login>:<duty>:
 *   <ts>`) and `appendInboxFeed` dedupes by id, so re-scanning the same
 *   records on a later push is a cheap noop. Never throws — logs and
 *   swallows so a feed-write failure can't break webhook delivery.
 */
import "server-only";
import { STATE_BRANCH } from "../state-branch";
import {
  setGitHubContext,
  clearGitHubContext,
  createUserOctokit,
  fetchCompanyActivity,
} from "../github-client";
import { readOperators } from "../engine/config";
import { resolveBackgroundToken } from "../auth/background-token";
import { appendInboxFeed } from "../inbox/feed-server";
import type { InboxFeedEntry } from "../inbox/feed";
import type { CompanyActivityRecord } from "../activity/company";
import { logger } from "../logger";

const ACTIVITY_PATH_PREFIX = ".kody/activity/";
/** Only surface failures recorded recently. The triggering push commits the
 *  failure record the instant it happens, so this just bounds how far back a
 *  single scan looks — it never needs to reach beyond the current run. */
const FAILURE_LOOKBACK_MS = 24 * 60 * 60 * 1000;

interface PushCommit {
  added?: unknown;
  modified?: unknown;
}

/** True when this `push` event committed to the state branch and touched a
 *  Company Activity day-file (the only thing we care about). Exported for
 *  unit tests. */
export function touchesActivityLog(payload: Record<string, unknown>): boolean {
  const ref = typeof payload.ref === "string" ? payload.ref : "";
  if (ref !== `refs/heads/${STATE_BRANCH}`) return false;
  const commits = Array.isArray(payload.commits)
    ? (payload.commits as PushCommit[])
    : [];
  return commits.some((c) => {
    const paths = [
      ...(Array.isArray(c.added) ? (c.added as unknown[]) : []),
      ...(Array.isArray(c.modified) ? (c.modified as unknown[]) : []),
    ];
    return paths.some(
      (p) => typeof p === "string" && p.startsWith(ACTIVITY_PATH_PREFIX),
    );
  });
}

/** One inbox-feed entry per (operator × failed record). Exported for unit
 *  tests. */
export function buildEntries(
  owner: string,
  repo: string,
  operators: string[],
  failures: CompanyActivityRecord[],
): InboxFeedEntry[] {
  const repoFullName = `${owner}/${repo}`;
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const entries: InboxFeedEntry[] = [];
  for (const rec of failures) {
    const who = rec.staffTitle ?? rec.staff ?? "Kody";
    const title = `Duty failed: ${rec.dutyTitle ?? rec.duty}`;
    const snippet = `${who} — ${rec.trigger} run failed`;
    for (const login of operators) {
      entries.push({
        id: `duty-fail:${login}:${rec.duty}:${rec.ts}`,
        login,
        source: "other",
        repoFullName,
        threadType: "Run",
        title,
        snippet,
        author: rec.staff ?? undefined,
        url: rec.runUrl ?? repoUrl,
        sentAt: rec.ts,
      });
    }
  }
  return entries;
}

/**
 * Entry point — call from the webhook receiver on every event. Returns early
 * for anything that isn't a state-branch push touching the activity log, so
 * it's a cheap noop on the hot mention/comment path. Never throws.
 */
export async function dispatchDutyFailures(
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    if (eventType !== "push" || !touchesActivityLog(payload)) return;

    const repository = payload.repository as
      | Record<string, unknown>
      | undefined;
    const repoFullName =
      typeof repository?.full_name === "string" ? repository.full_name : "";
    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) return;

    // Unauthenticated webhook → App installation token (preferred) or vault
    // GITHUB_TOKEN fallback, same as mention dispatch.
    const bg = await resolveBackgroundToken(owner, repo);
    if (!bg) {
      logger.warn(
        { event: "duty_failure_no_token", repo: repoFullName },
        "No App install or vault GITHUB_TOKEN for repo — cannot read activity / write inbox feed",
      );
      return;
    }
    const token = bg.token;

    // Operators are the audience. Empty list = nobody to notify — the same
    // silent-inbox state the Operators card already warns about.
    const operators = await readOperators(
      createUserOctokit(token),
      owner,
      repo,
    );
    if (operators.length === 0) {
      logger.info(
        { event: "duty_failure_no_operators", repo: repoFullName },
        "Duty failed but no operators configured — nothing to route",
      );
      return;
    }

    setGitHubContext(owner, repo, token);
    try {
      const records = await fetchCompanyActivity(100);
      const cutoff = Date.now() - FAILURE_LOOKBACK_MS;
      const failures = records.filter((r) => {
        if (r.outcome !== "failed") return false;
        const t = Date.parse(r.ts);
        return Number.isNaN(t) || t >= cutoff;
      });
      if (failures.length === 0) return;

      const entries = buildEntries(owner, repo, operators, failures);
      const added = await appendInboxFeed(entries);
      logger.info(
        {
          event: "duty_failure_inbox_appended",
          added,
          failures: failures.length,
          operators: operators.length,
          repo: repoFullName,
        },
        `Duty-failure inbox: +${added} entr${added === 1 ? "y" : "ies"}`,
      );
    } finally {
      clearGitHubContext();
    }
  } catch (err) {
    logger.error(
      {
        event: "duty_failure_dispatch_crashed",
        error: err instanceof Error ? err.message : String(err),
      },
      "dispatchDutyFailures threw — swallowing so webhook still ACKs",
    );
  }
}
