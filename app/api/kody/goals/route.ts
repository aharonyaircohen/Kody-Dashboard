/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern goals-api
 * @ai-summary Goals API — GET lists goals from the manifest issue; POST creates
 *   a goal (creating the manifest issue on first use). Goals are JSON entries
 *   inside a single GitHub issue labelled `kody:goals-manifest`. Writes go
 *   through `mutateGoalsManifest` so concurrent goal mutations can't silently
 *   overwrite each other (per-instance mutex + verify-after-write retry).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  verifyActorLogin,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import {
  fetchIssues,
  ensureLabel,
  setGitHubContext,
  clearGitHubContext,
  fetchRepoDiscussionMeta,
  createGoalDiscussion,
  enableRepoDiscussions,
} from "@dashboard/lib/github-client";
import {
  EMPTY_MANIFEST,
  GOALS_MANIFEST_LABEL,
  goalLabel,
  parseManifestBody,
  slugifyGoalName,
  uniqueGoalId,
  goalDiscussionSeedBody,
  type Goal,
  type GoalsManifest,
} from "@dashboard/lib/goals";
import { mutateGoalsManifest } from "@dashboard/lib/goals-server";
import { recordAudit } from "@dashboard/lib/activity/audit";

const GOAL_LABEL_COLOR = "38bdf8"; // Tailwind sky-400

type ManifestIssueRef = { number: number; body: string };

async function findManifestIssue(): Promise<ManifestIssueRef | null> {
  // Short TTL keeps cross-instance staleness bounded. Post-TTL revalidation
  // returns 304 (free) via the cached ETag when nothing changed; on writes,
  // the route invalidates this instance's cache directly.
  // NOTE: `fetchIssues` already returns the full body for list items, so we
  // intentionally do NOT make a follow-up `fetchIssue` call here — that
  // doubled GitHub REST cost on every poll and was a rate-limit hot spot.
  const issues = await fetchIssues({
    state: "open",
    labels: GOALS_MANIFEST_LABEL,
    perPage: 5,
    ttl: 15_000,
  });
  if (!issues.length) return null;
  // If multiple exist, prefer the earliest created (stable anchor).
  const sorted = [...issues].sort((a, b) => a.number - b.number);
  const first = sorted[0];
  return { number: first.number, body: first.body ?? "" };
}

async function readManifest(): Promise<{
  manifest: GoalsManifest;
  issue: ManifestIssueRef | null;
}> {
  const issue = await findManifestIssue();
  const manifest = issue
    ? parseManifestBody(issue.body)
    : { ...EMPTY_MANIFEST, goals: [] };
  return { manifest, issue };
}

function mapGithubError(error: any, fallback: string, status = 500) {
  if (error?.status === 401) {
    return NextResponse.json(
      { error: "github_token_expired" },
      { status: 401 },
    );
  }
  if (error?.status === 403 || error?.message?.includes("rate limit")) {
    return NextResponse.json(
      { error: "rate_limited", message: "GitHub API rate limit exceeded" },
      { status: 429 },
    );
  }
  return NextResponse.json(
    { error: fallback, message: error?.message ?? fallback },
    { status },
  );
}

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const { manifest, issue } = await readManifest();
    // Best-effort capability lookup. Cached 10min, so this doesn't add a
    // GraphQL hit per poll. Failures (rate limit, no perms) just mean the UI
    // assumes Discussions are off and shows the disabled badge.
    let discussionsEnabled = false;
    try {
      const meta = await fetchRepoDiscussionMeta();
      discussionsEnabled = meta.enabled && !!meta.categoryId;
    } catch (capErr) {
      console.warn("[Goals] discussion capability lookup failed:", capErr);
    }

    // Stacked-PR model (engine ≥ 0.4.39): no umbrella issue, no goal PR.
    // Goals carry only manifest-authored fields (id, name, description,
    // dueDate, etc.). Per-goal task PRs are discovered on the tasks route.
    return NextResponse.json(
      {
        goals: manifest.goals,
        manifest: { issueNumber: issue?.number ?? null },
        capabilities: { discussionsEnabled },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    console.error("[Goals] Error listing goals:", error);
    return mapGithubError(error, "list_failed");
  } finally {
    clearGitHubContext();
  }
}

const createGoalSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  dueDate: z.string().optional(),
  assignee: z.string().max(120).optional(),
  actorLogin: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const payload = await req.json();
    const parsed = createGoalSchema.parse(payload);

    const actorResult = await verifyActorLogin(req, parsed.actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);

    // Try to provision a backing discussion *before* the manifest write so
    // both halves land in one CAS. Auto-enables Discussions on the repo if
    // they're off and the user has admin perms — silent fallback if not.
    // Failures are non-fatal: the goal is still created without a thread
    // and the UI shows the "Discussions off" badge with the right reason.
    let discussionRef: { id: string; number: number } | null = null;
    try {
      let meta = await fetchRepoDiscussionMeta();
      if (!meta.enabled && userOctokit) {
        const enabled = await enableRepoDiscussions(userOctokit);
        if (enabled.ok) {
          meta = await fetchRepoDiscussionMeta();
        }
      }
      if (meta.enabled && meta.categoryId) {
        const created = await createGoalDiscussion(
          {
            title: `Goal: ${parsed.name.trim()}`,
            body: goalDiscussionSeedBody({
              name: parsed.name.trim(),
              description: parsed.description?.trim(),
              dueDate: parsed.dueDate?.trim(),
            }),
            categoryId: meta.categoryId,
          },
          userOctokit ?? undefined,
        );
        discussionRef = { id: created.id, number: created.number };
      }
    } catch (discErr) {
      console.warn(
        "[Goals] createGoalDiscussion failed (continuing without thread):",
        discErr,
      );
    }

    const outcome = await mutateGoalsManifest<Goal>(
      (current) => {
        const id = uniqueGoalId(slugifyGoalName(parsed.name), current.goals);
        const now = new Date().toISOString();
        const newGoal: Goal = {
          id,
          name: parsed.name.trim(),
          description: parsed.description?.trim() || undefined,
          dueDate: parsed.dueDate?.trim() || undefined,
          assignee: parsed.assignee?.trim() || undefined,
          createdAt: now,
          updatedAt: now,
          discussionId: discussionRef?.id,
          discussionNumber: discussionRef?.number,
        };
        return {
          next: { version: 1, goals: [...current.goals, newGoal] },
          result: newGoal,
        };
      },
      { userOctokit: userOctokit ?? undefined },
    );

    if ("kind" in outcome) {
      // Mutator never returns noop in the create path.
      return NextResponse.json({ error: "create_failed" }, { status: 500 });
    }
    const newGoal = outcome.result;

    // Pre-create the `goal:<id>` repo label so attach operations later don't
    // 422. GitHub's addLabels endpoint requires the label to exist already.
    try {
      await ensureLabel(
        goalLabel(newGoal.id),
        {
          color: GOAL_LABEL_COLOR,
          description: `Tasks attached to goal: ${newGoal.name}`,
        },
        userOctokit ?? undefined,
      );
    } catch (labelErr) {
      // Non-fatal — the add-label action route will ensure on-demand too
      console.warn("[Goals] ensureLabel failed (continuing):", labelErr);
    }

    recordAudit(req, {
      action: "goal.create",
      resource: newGoal.id,
      detail: `created goal "${newGoal.name}"`,
    });

    return NextResponse.json({ goal: newGoal });
  } catch (error: any) {
    console.error("[Goals] Error creating goal:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: error.issues },
        { status: 400 },
      );
    }
    return mapGithubError(error, "create_failed");
  } finally {
    clearGitHubContext();
  }
}
