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
import {
  setGitHubContext,
  clearGitHubContext,
} from "../github-client";
import { resolveBackgroundToken } from "../auth/background-token";
import { readPushManifest } from "../push-server";
import { deliverPush, ensureVapid } from "../notifications/channels/push-core";
import { logger } from "../logger";

const REPORTS_PATH_PREFIX = ".kody/reports/";

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
      if (["ceo", "cto", "coo", "qa", "pr", "ui", "ux", "ci", "api"].includes(part)) {
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
    let subscriptions;
    try {
      const ref = await readPushManifest();
      subscriptions = ref.manifest.subscriptions;
    } finally {
      clearGitHubContext();
    }
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
    for (const slug of slugs) {
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
        reports: slugs.length,
        subscribers: subscriptions.length,
        sent: totalSent,
        pruned: totalPruned,
      },
      `Report push fan-out: ${slugs.length} report(s) × ${subscriptions.length} sub(s) → ${totalSent} sent`,
    );
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
