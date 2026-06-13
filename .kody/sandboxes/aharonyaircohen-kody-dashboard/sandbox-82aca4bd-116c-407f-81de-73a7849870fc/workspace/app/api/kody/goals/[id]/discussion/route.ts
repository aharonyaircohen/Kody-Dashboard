/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern goal-discussion-api
 * @ai-summary GET fetches comments for a goal's backing GitHub Discussion;
 *   POST adds a new comment. Lazily creates the discussion on first access if
 *   the goal doesn't have one yet (e.g. pre-existing goals from before this
 *   feature shipped). The lazy-create is wrapped in `mutateGoalsManifest` so
 *   the new discussion ID is stored back on the manifest atomically.
 *
 *   When the repo has Discussions disabled (or the "Goals" category is
 *   missing), GET returns `{ enabled: false }` and the UI hides the thread.
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
  setGitHubContext,
  clearGitHubContext,
  fetchRepoDiscussionMeta,
  fetchGoalDiscussionComments,
  postGoalDiscussionComment,
  createGoalDiscussion,
  enableRepoDiscussions,
  getOwner,
  getRepo,
} from "@dashboard/lib/github-client";
import {
  type Goal,
  type GoalsManifest,
  goalDiscussionSeedBody,
} from "@dashboard/lib/goals";
import { mutateGoalsManifest } from "@dashboard/lib/goals-server";

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

type EnsureGoalResult =
  | { ok: true; goal: Goal }
  | { ok: false; reason: "not_found" };

type UserOctokit = Awaited<ReturnType<typeof getUserOctokit>>;

/**
 * Result of the auto-enable flow: either we have an enabled repo with a
 * category to file goals under, or we explain why we couldn't get there.
 * The reason matches the {@link DiscussionDisabledReason} union on the
 * client so the UI can drive the disabled badge directly off it.
 */
type EnableMetaOutcome =
  | { ok: true; categoryId: string }
  | { ok: false; reason: "discussions_disabled"; message: string }
  | { ok: false; reason: "category_missing"; message: string };

async function ensureDiscussionsReady(
  userOctokit: UserOctokit,
): Promise<EnableMetaOutcome> {
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

/**
 * Returns the goal's discussion, creating it if missing. The caller is
 * responsible for ensuring Discussions are enabled + a category is
 * available; we take the {@link categoryId} explicitly to avoid a second
 * meta fetch and to make the contract honest.
 *
 * Returns `goal: null` only if the goal id doesn't exist in the manifest.
 */
async function ensureGoalDiscussion(
  goalId: string,
  categoryId: string,
  userOctokit: UserOctokit,
): Promise<{ ref: { id: string; number: number } | null; goal: Goal | null }> {
  type MutatorReturn =
    | { kind: "noop"; result: EnsureGoalResult }
    | { next: GoalsManifest; result: EnsureGoalResult };

  const outcome = await mutateGoalsManifest<EnsureGoalResult>(
    async (current): Promise<MutatorReturn> => {
      const idx = current.goals.findIndex((g) => g.id === goalId);
      if (idx === -1) {
        return {
          kind: "noop",
          result: { ok: false, reason: "not_found" },
        };
      }
      const goal = current.goals[idx];
      if (goal.discussionId && goal.discussionNumber) {
        // Already provisioned — short-circuit, no manifest write.
        return { kind: "noop", result: { ok: true, goal } };
      }

      const created = await createGoalDiscussion(
        {
          title: `Goal: ${goal.name}`,
          body: goalDiscussionSeedBody({
            name: goal.name,
            description: goal.description,
            dueDate: goal.dueDate,
          }),
          categoryId,
        },
        userOctokit ?? undefined,
      );
      const updated: Goal = {
        ...goal,
        discussionId: created.id,
        discussionNumber: created.number,
        updatedAt: new Date().toISOString(),
      };
      const nextGoals = [...current.goals];
      nextGoals[idx] = updated;
      const next: GoalsManifest = { version: 1, goals: nextGoals };
      return { next, result: { ok: true, goal: updated } };
    },
    { userOctokit: userOctokit ?? undefined },
  );

  const r: EnsureGoalResult =
    "kind" in outcome ? outcome.result : outcome.result;
  if (!r.ok) return { ref: null, goal: null };
  if (!r.goal.discussionId || !r.goal.discussionNumber) {
    return { ref: null, goal: r.goal };
  }
  return {
    ref: { id: r.goal.discussionId, number: r.goal.discussionNumber },
    goal: r.goal,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const { id } = await params;
    const userOctokit = await getUserOctokit(req);

    const ready = await ensureDiscussionsReady(userOctokit);
    if (!ready.ok) {
      return NextResponse.json(
        {
          enabled: false,
          reason: ready.reason,
          message: ready.message,
          comments: [],
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const { ref, goal } = await ensureGoalDiscussion(
      id,
      ready.categoryId,
      userOctokit,
    );
    if (!goal) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (!ref) {
      return NextResponse.json(
        {
          enabled: false,
          reason: "provision_failed",
          comments: [],
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const comments = await fetchGoalDiscussionComments(ref.number);
    return NextResponse.json(
      {
        enabled: true,
        discussion: {
          id: ref.id,
          number: ref.number,
          url: `https://github.com/${getOwner()}/${getRepo()}/discussions/${ref.number}`,
        },
        comments,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    console.error("[GoalDiscussion] GET error:", error);
    return mapGithubError(error, "discussion_load_failed");
  } finally {
    clearGitHubContext();
  }
}

const postSchema = z.object({
  body: z.string().min(1).max(65000),
  actorLogin: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth)
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    const { id } = await params;
    const payload = await req.json();
    const parsed = postSchema.parse(payload);

    const actorResult = await verifyActorLogin(req, parsed.actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const userOctokit = await getUserOctokit(req);
    if (!userOctokit) {
      return NextResponse.json({ error: "no_user_token" }, { status: 401 });
    }

    const ready = await ensureDiscussionsReady(userOctokit);
    if (!ready.ok) {
      return NextResponse.json(
        {
          error: "discussions_unavailable",
          reason: ready.reason,
          message: ready.message,
        },
        { status: 409 },
      );
    }

    const { ref, goal } = await ensureGoalDiscussion(
      id,
      ready.categoryId,
      userOctokit,
    );
    if (!goal) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (!ref) {
      return NextResponse.json(
        { error: "discussions_unavailable" },
        { status: 409 },
      );
    }

    const comment = await postGoalDiscussionComment(
      { discussionId: ref.id, body: parsed.body, discussionNumber: ref.number },
      userOctokit,
    );
    return NextResponse.json({ comment });
  } catch (error: any) {
    console.error("[GoalDiscussion] POST error:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation_error", details: error.issues },
        { status: 400 },
      );
    }
    return mapGithubError(error, "comment_post_failed");
  } finally {
    clearGitHubContext();
  }
}
