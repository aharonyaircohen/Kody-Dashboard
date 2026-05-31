/**
 * @fileType utility
 * @domain kody
 * @pattern report-push-dispatch
 * @ai-summary Server-only helper that fires a Web Push browser banner to
 *   every subscribed device when a Kody duty writes (or updates) a report
 *   under `.kody/reports/<slug>.md`. Unlike the mention spine
 *   (`mention-dispatch.ts`), this is **broadcast** — reports are produced by
 *   the system on a schedule and are interesting to anyone who's enabled push
 *   for this repo, not just whoever was @-mentioned (nobody is).
 *
 *   Trigger: a `push` event to the **default branch** that adds or modifies
 *   one or more files under `.kody/reports/<slug>.md`. State-branch pushes
 *   are ignored (state lives there, not reports), and pushes that touch
 *   anything outside `.kody/reports/` are a cheap no-op so this stays off
 *   the hot path.
 *
 *   Per affected report we send one push tagged with the report's dashboard
 *   URL so repeated updates to the same report collapse into a single banner
 *   on each device rather than stacking. Click lands on `/duties?tab=reports`,
 *   where the per-row "unread" dot makes which one is new obvious.
 *
 *   Never throws — logs and swallows so a push-fan-out failure can't break
 *   webhook delivery.
 */
import "server-only";
import type { Octokit } from "@octokit/rest";
import {
  setGitHubContext,
  clearGitHubContext,
  getOctokit,
} from "../github-client";
import { resolveBackgroundToken } from "../auth/background-token";
import { readPushManifest } from "../push-server";
import { deliverPush, ensureVapid } from "../notifications/channels/push-core";
import { logger } from "../logger";

const REPORTS_PATH_PREFIX = ".kody/reports/";

/** All-zero SHA GitHub sends as `before` when a branch is created — there's no
 *  prior commit to diff against, so a report touched in such a push is new. */
const ZERO_SHA = "0000000000000000000000000000000000000000";

interface PushCommit {
  added?: unknown;
  modified?: unknown;
}

/**
 * Extract the unique report slugs touched by this push (added or modified).
 * A "touch" means a path of the exact form `.kody/reports/<slug>.md` —
 * subdirectories or non-markdown sidecars are ignored. Exported for tests.
 */
export function extractTouchedReportSlugs(
  payload: Record<string, unknown>,
): string[] {
  const commits = Array.isArray(payload.commits)
    ? (payload.commits as PushCommit[])
    : [];
  const slugs = new Set<string>();
  for (const c of commits) {
    const paths = [
      ...(Array.isArray(c.added) ? (c.added as unknown[]) : []),
      ...(Array.isArray(c.modified) ? (c.modified as unknown[]) : []),
    ];
    for (const p of paths) {
      if (typeof p !== "string") continue;
      if (!p.startsWith(REPORTS_PATH_PREFIX)) continue;
      const tail = p.slice(REPORTS_PATH_PREFIX.length);
      // Only top-level <slug>.md — skip nested dirs or other extensions so
      // ad-hoc files under .kody/reports/ don't trigger noisy banners.
      if (tail.includes("/")) continue;
      if (!tail.endsWith(".md")) continue;
      const slug = tail.slice(0, -".md".length);
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug)) continue;
      slugs.add(slug);
    }
  }
  return [...slugs];
}

/** True when the push targets the repo's default branch (reports live there). */
export function isPushToDefaultBranch(
  payload: Record<string, unknown>,
): boolean {
  const ref = typeof payload.ref === "string" ? payload.ref : "";
  const repository = payload.repository as Record<string, unknown> | undefined;
  const def =
    typeof repository?.default_branch === "string"
      ? repository.default_branch
      : "";
  if (!def) return false;
  return ref === `refs/heads/${def}`;
}

/** Convert a slug to a human title for the banner ("ceo-performance-review" →
 *  "CEO Performance Review"). The real title lives in the report's H1, but
 *  fetching it would be an extra API call per push for a banner that's about
 *  to be replaced once the user opens the report. The slug is the stable id
 *  the rest of the dashboard uses, so it's the right fallback here. */
function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => {
      if (part.length === 0) return part;
      // Treat known acronyms specially.
      const upper = part.toUpperCase();
      if (
        ["ceo", "cto", "coo", "qa", "pr", "ui", "ux", "ci", "api"].includes(
          part,
        )
      ) {
        return upper;
      }
      return part[0]!.toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function buildPayload(slug: string, repoFullName: string): string {
  const title = `📊 New report: ${humanizeSlug(slug)}`;
  const body = `${repoFullName} — open Reports to view.`;
  // Deep link into the dashboard Reports tab. The per-row unread dot makes
  // which report is new obvious without server-side per-slug routing.
  const url = `/duties?tab=reports`;
  return JSON.stringify({
    title,
    body,
    url,
    // Per-report tag: repeat updates to the same slug collapse into one
    // banner; different reports stay separate and individually tappable.
    tag: `kody-report:${slug}`,
  });
}

/**
 * Drop lines that change every tick without the report's meaning changing.
 * The engine stamps `_Last updated: <ISO>_` into every report on every rerun,
 * so a re-save with no real change still differs by exactly this one line
 * (this is ~68% of report pushes — e.g. job-gap-scan re-proposing the same
 * duty hourly). Stripping it before comparison is what separates "genuinely
 * new/updated report" from "same report, fresh timestamp". Matches the line
 * however it's wrapped in markdown emphasis (`_..._`, `*..*`, blockquote).
 * Exported for tests.
 */
export function stripVolatileLines(markdown: string): string {
  return markdown
    .split("\n")
    .filter((line) => !/^\s*[*_>\s]*last updated:/i.test(line))
    .join("\n")
    .trim();
}

/** Fetch a report's raw markdown at a specific commit, or null if it didn't
 *  exist there (404) or isn't a readable file. Throws on other errors so the
 *  caller can fail open. */
async function fetchReportAtRef(
  octokit: Octokit,
  owner: string,
  repo: string,
  slug: string,
  ref: string,
): Promise<string | null> {
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: `${REPORTS_PATH_PREFIX}${slug}.md`,
      ref,
    });
    if (Array.isArray(data) || !("content" in data) || !data.content) {
      return null;
    }
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch (err) {
    if ((err as { status?: number })?.status === 404) return null;
    throw err;
  }
}

/**
 * True when the report's content meaningfully changed across this push —
 * i.e. it differs once the volatile `_Last updated:` line is ignored. A newly
 * added report (no prior version) counts as changed. Fails OPEN (returns true)
 * on any unexpected read error, so a transient GitHub hiccup never silently
 * drops a push for a report that really did change.
 */
async function reportContentChanged(
  octokit: Octokit,
  owner: string,
  repo: string,
  slug: string,
  beforeSha: string,
  afterSha: string,
): Promise<boolean> {
  // Branch-create / no resolvable parent → treat as a brand-new report.
  if (!beforeSha || beforeSha === ZERO_SHA || !afterSha) return true;
  try {
    const [before, after] = await Promise.all([
      fetchReportAtRef(octokit, owner, repo, slug, beforeSha),
      fetchReportAtRef(octokit, owner, repo, slug, afterSha),
    ]);
    if (before === null) return true; // newly added → real new report
    if (after === null) return false; // deleted/unreadable → nothing to notify
    return stripVolatileLines(before) !== stripVolatileLines(after);
  } catch {
    return true; // fail open — never drop a genuine report on a read error
  }
}

/**
 * Entry point — call from the webhook receiver on every event. Returns
 * early for anything that isn't a default-branch push touching
 * `.kody/reports/<slug>.md`, so it's a cheap noop on the hot
 * mention/comment path. Never throws.
 */
export async function dispatchReportPushes(
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    if (eventType !== "push") return;
    if (!isPushToDefaultBranch(payload)) return;

    const slugs = extractTouchedReportSlugs(payload);
    if (slugs.length === 0) return;

    const repository = payload.repository as
      | Record<string, unknown>
      | undefined;
    const repoFullName =
      typeof repository?.full_name === "string" ? repository.full_name : "";
    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) return;

    const beforeSha = typeof payload.before === "string" ? payload.before : "";
    const afterSha = typeof payload.after === "string" ? payload.after : "";

    // Unauthenticated webhook → App installation token (preferred) or vault
    // GITHUB_TOKEN fallback, same as the other server-side dispatchers.
    const bg = await resolveBackgroundToken(owner, repo);
    if (!bg) {
      logger.warn(
        { event: "report_push_no_token", repo: repoFullName },
        "No App install or vault GITHUB_TOKEN — cannot read push manifest for report broadcast",
      );
      return;
    }
    const token = bg.token;

    if (!ensureVapid()) {
      logger.warn(
        { event: "report_push_no_vapid" },
        "VAPID keys unavailable — KODY_MASTER_KEY unset?",
      );
      return;
    }

    setGitHubContext(owner, repo, token);
    try {
      // Suppress the timestamp-only churn: keep only reports whose body
      // actually changed (ignoring the volatile `_Last updated:` line). This
      // is the whole point of the fix — re-saves that bump only the timestamp
      // (the bulk of report pushes) no longer fire a banner.
      const octokit = getOctokit();
      const changed: string[] = [];
      for (const slug of slugs) {
        if (
          await reportContentChanged(
            octokit,
            owner,
            repo,
            slug,
            beforeSha,
            afterSha,
          )
        ) {
          changed.push(slug);
        }
      }
      if (changed.length === 0) {
        logger.info(
          {
            event: "report_push_skipped_no_content_change",
            repo: repoFullName,
            candidates: slugs.length,
          },
          `Report push skipped: ${slugs.length} report(s) re-saved with only a timestamp change`,
        );
        return;
      }

      const ref = await readPushManifest();
      const subscriptions = ref.manifest.subscriptions;
      if (subscriptions.length === 0) {
        logger.info(
          { event: "report_push_no_subscribers", repo: repoFullName },
          "Report committed but no push subscribers on this repo",
        );
        return;
      }

      // One delivery pass per affected report so each lands as its own banner
      // (different `tag`s). Each pass shares the same prune-on-expiry path.
      let totalSent = 0;
      let totalPruned = 0;
      for (const slug of changed) {
        const payloadFor = () => buildPayload(slug, repoFullName);
        const result = await deliverPush({
          subscriptions,
          payload: payloadFor,
          github: { owner, repo, token },
          logLabel: "report_push",
        });
        totalSent += result.sent;
        totalPruned += result.pruned;
      }

      logger.info(
        {
          event: "report_push_delivered",
          repo: repoFullName,
          reports: changed.length,
          skipped: slugs.length - changed.length,
          subscribers: subscriptions.length,
          sent: totalSent,
          pruned: totalPruned,
        },
        `Report push fan-out: ${changed.length} report(s) × ${subscriptions.length} sub(s) → ${totalSent} sent`,
      );
    } finally {
      clearGitHubContext();
    }
  } catch (err) {
    logger.error(
      {
        event: "report_push_dispatch_crashed",
        error: err instanceof Error ? err.message : String(err),
      },
      "dispatchReportPushes threw — swallowing so webhook still ACKs",
    );
  }
}
