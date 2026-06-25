/**
 * @fileType utility
 * @domain kody
 * @pattern agentResponsibility-failure-inbox-dispatch
 * @ai-summary Server-only helper that turns a failed agentResponsibility run into an inbox
 *   entry for every operator — so a silent failure stops being silent.
 *
 *   Why here, not in the engine: a scheduled agentResponsibility tick is fanned out from
 *   cron with no triggering issue to comment on, and the engine config has
 *   no `operators` list (that lives only in the dashboard's
 *   kody.config.json). So the engine can't @-mention anyone. But it already
 *   reports every tick — including `outcome: "failed"` — into the Company
 *   Activity log (`<repo>/activity/<date>.jsonl`, committed to the
 *   Kody state repo by `appendCompanyActivity`). That commit fires a
 *   `push` webhook, which is our trigger: read the recent failed records and
 *   append one inbox-feed entry per operator, exactly like
 *   `mention-dispatch.ts` does for `@mentions`. The existing inbox watcher
 *   then syncs each operator's slice into their private gist inbox.
 *
 *   Idempotent: entries carry a deterministic id (`agentResponsibility-fail:<login>:<agentResponsibility>:
 *   <ts>`) and `appendInboxFeed` dedupes by id, so re-scanning the same
 *   records on a later push is a cheap noop. Never throws — logs and
 *   swallows so a feed-write failure can't break webhook delivery.
 */
import "server-only";
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

const ACTIVITY_PATH_RE = /^([^/]+)\/activity\/[^/]+\.jsonl$/;
/** Only surface failures recorded recently. The triggering push commits the
 *  failure record the instant it happens, so this just bounds how far back a
 *  single scan looks — it never needs to reach beyond the current run. */
const FAILURE_LOOKBACK_MS = 24 * 60 * 60 * 1000;

interface PushCommit {
  added?: unknown;
  modified?: unknown;
}

/** True when this `push` event touched the Kody state repo and touched a
 *  Company Activity day-file (the only thing we care about). Exported for
 *  unit tests. */
export function touchedActivityRepos(
  payload: Record<string, unknown>,
): string[] {
  const commits = Array.isArray(payload.commits)
    ? (payload.commits as PushCommit[])
    : [];
  const repos = new Set<string>();
  for (const c of commits) {
    const paths = [
      ...(Array.isArray(c.added) ? (c.added as unknown[]) : []),
      ...(Array.isArray(c.modified) ? (c.modified as unknown[]) : []),
    ];
    for (const p of paths) {
      if (typeof p !== "string") continue;
      const match = ACTIVITY_PATH_RE.exec(p);
      if (match?.[1]) repos.add(match[1]);
    }
  }
  return [...repos];
}

/** True when this push event touched a Company Activity day-file. Exported for
 *  unit tests. */
export function touchesActivityLog(payload: Record<string, unknown>): boolean {
  return touchedActivityRepos(payload).length > 0;
}

/** Failure kinds where the agent stopped before finishing — the run didn't
 *  "fail" in the work sense, it never got to do the work. Worth wording
 *  differently so an operator isn't sent chasing a broken result that doesn't
 *  exist. */
const STOPPED_EARLY_KINDS = new Set(["stalled", "out_of_turns", "rate_limit"]);

/** Turn the engine's structured `outcomeKind` into a plain-English phrase for
 *  the inbox snippet. Falls back to the raw `reason` text, then a generic
 *  "failed" for older records that carry neither. */
function describeFailure(rec: CompanyActivityRecord): string {
  switch (rec.outcomeKind) {
    case "stalled":
      return "agent stalled (no response)";
    case "out_of_turns":
      return "agent hit its turn limit";
    case "rate_limit":
      return "rate-limited by the model";
    case "tool_error":
      return "a tool failed";
    case "model_error":
      return "model error";
  }
  if (rec.reason) return rec.reason;
  return "run failed";
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
    const who = rec.staffTitle ?? rec.agent ?? "Kody";
    const stoppedEarly =
      rec.outcomeKind != null && STOPPED_EARLY_KINDS.has(rec.outcomeKind);
    const what = rec.agentResponsibilityTitle ?? rec.agentResponsibility;
    const title = stoppedEarly
      ? `AgentResponsibility stopped early: ${what}`
      : `AgentResponsibility failed: ${what}`;
    const snippet = `${who} — ${describeFailure(rec)}`;
    for (const login of operators) {
      entries.push({
        id: `agentResponsibility-fail:${login}:${rec.agentResponsibility}:${rec.ts}`,
        login,
        source: "other",
        repoFullName,
        threadType: "Run",
        title,
        snippet,
        author: rec.agent ?? undefined,
        url: rec.runUrl ?? repoUrl,
        sentAt: rec.ts,
      });
    }
  }
  return entries;
}

/**
 * Entry point — call from the webhook receiver on every event. Returns early
 * for anything that isn't a state-repo push touching the activity log, so
 * it's a cheap noop on the hot mention/comment path. Never throws.
 */
export async function dispatchAgentResponsibilityFailures(
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    if (eventType !== "push") return;
    const touchedRepos = touchedActivityRepos(payload);
    if (touchedRepos.length === 0) return;

    const repository = payload.repository as
      | Record<string, unknown>
      | undefined;
    const stateRepoFullName =
      typeof repository?.full_name === "string" ? repository.full_name : "";
    const [owner] = stateRepoFullName.split("/");
    if (!owner) return;

    for (const repo of touchedRepos) {
      const repoFullName = owner + "/" + repo;
      const bg = await resolveBackgroundToken(owner, repo);
      if (!bg) {
        logger.warn(
          { event: "agentResponsibility_failure_no_token", repo: repoFullName },
          "No App install or vault GITHUB_TOKEN repo — cannot read activity / write inbox feed",
        );
        continue;
      }
      const token = bg.token;

      const operators = await readOperators(
        createUserOctokit(token),
        owner,
        repo,
      );
      if (operators.length === 0) {
        logger.info(
          {
            event: "agentResponsibility_failure_no_operators",
            repo: repoFullName,
          },
          "AgentResponsibility failed but no operators configured — nothing route",
        );
        continue;
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
        if (failures.length === 0) continue;
        const entries = buildEntries(owner, repo, operators, failures);
        const added = await appendInboxFeed(entries);
        logger.info(
          {
            event: "agentResponsibility_failure_inbox_appended",
            added,
            failures: failures.length,
            operators: operators.length,
            repo: repoFullName,
          },
          "AgentResponsibility-failure inbox: +" +
            added +
            " entr" +
            (added === 1 ? "y" : "ies"),
        );
      } finally {
        clearGitHubContext();
      }
    }
  } catch (err) {
    logger.error(
      {
        event: "agentResponsibility_failure_dispatch_crashed",
        error: err instanceof Error ? err.message : String(err),
      },
      "dispatchAgentResponsibilityFailures threw — swallowing so webhook still ACKs",
    );
  }
}
