/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern tasks-api
 * @ai-summary API route to fetch and create tasks (GitHub issues)
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
  fetchWorkflowRuns,
  fetchOpenPRs,
  fetchDeploymentPreviews,
  findBranchesByIssueNumbers,
  getStatusFromBranch,
  findStatusOnBranch,
  createIssue,
  uploadIssueAttachment,
  postComment,
  setGitHubContext,
  clearGitHubContext,
  fetchKodyState,
} from "@dashboard/lib/github-client";
import type { KodyTaskState } from "@dashboard/lib/kody-state";
import type {
  KodyTask,
  ColumnId,
  GitHubIssue,
  GitHubPR,
  WorkflowRun,
  KodyPipelineStatus,
} from "@dashboard/lib/types";
import { matchWorkflowRunToTask } from "@dashboard/lib/workflow-matching";
import {
  parseKodyPhase,
  parseKodyFlow,
  TASK_ID_REGEX,
} from "@dashboard/lib/constants";

/**
 * Extract a real kody task ID from an issue title's leading `[…]`.
 *
 * Issue titles can carry brackets that look like task IDs but aren't —
 * priority labels (`[P0]`/`[P1]`/`[P2]`/`[P3]`), severity tags, etc. If
 * we treat those as task IDs, `matchWorkflowRunToTask`'s
 * `title.includes(taskId)` substring check leaks across every
 * priority-prefixed issue: e.g. an in-progress `[P2] Add client-side …`
 * run will "match" four other unrelated `[P2] …` issues, marking them
 * Building/running. Only accept brackets whose content matches the
 * canonical kody task-id shape (YYMMDD-…).
 */
function extractTaskId(title: string): string {
  const m = title.match(/^\[([^\]]+)\]/);
  if (!m) return "";
  const candidate = m[1];
  return TASK_ID_REGEX.test(candidate) ? candidate : "";
}

/**
 * Truncate a kody failure-reason string for inline display on the task card.
 * Engine reasons can be long (full agent tail, full verify output); keep the
 * first ~200 chars so the card stays scannable. The full reason is still
 * available in the engine's state comment for click-through.
 */
function truncateReason(s: string): string {
  const collapsed = s.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 200) return collapsed;
  return `${collapsed.slice(0, 200)}…`;
}

/**
 * Derive column from live pipeline status.
 * Pipeline state is more accurate than GitHub labels (no propagation delay).
 * Called first when pipeline data is available; label-based fallback used otherwise.
 */
function deriveColumnFromPipeline(pipeline: KodyPipelineStatus): ColumnId {
  switch (pipeline.state) {
    case "running":
      return "building";
    case "paused":
      return "gate-waiting";
    case "completed":
      return "review";
    case "failed":
    case "timeout":
      return "failed";
    default:
      return "building";
  }
}

/**
 * Derive gate type from pipeline controlMode. The dashboard no longer reads
 * `hard-stop` / `risk-gated` labels; gate state is sourced from pipeline JSON.
 */
function deriveGateType(
  pipeline?: KodyPipelineStatus | null,
): "hard-stop" | "risk-gated" | undefined {
  if (pipeline?.controlMode === "hard-stop") return "hard-stop";
  if (pipeline?.controlMode === "risk-gated") return "risk-gated";
  return undefined;
}

// Map GitHub issue state to column using agent labels, workflow runs, and PR status.
// Used as fallback when no live pipeline data is available.
// Priority: kodyState (canonical engine truth) > kody:failed/done > gate labels > kody:planning/building > active runs > completed runs > PR > other labels
function getColumnForIssue(
  issue: GitHubIssue,
  workflowRun?: WorkflowRun,
  associatedPR?: GitHubPR | null,
  kodyState?: KodyTaskState | null,
): ColumnId {
  const labelNames = issue.labels.map((l) => l.name.toLowerCase());

  // -2. Canonical engine state, when present, is the source of truth.
  //     Labels and workflow run conclusions can drift (e.g. a concurrency-
  //     cancelled duplicate run looks like a build failure to step 6 even
  //     though the engine actually succeeded). The state comment is what
  //     the engine itself recorded; trust it before the projections.
  if (kodyState) {
    const { phase, status } = kodyState.core;
    if (phase === "shipped") return "done";
    if (status === "failed" || phase === "failed") return "failed";
    if (status === "running") {
      if (phase === "reviewing" && (associatedPR || kodyState.core.prUrl))
        return "review";
      return "building";
    }
    if (status === "succeeded") {
      if (associatedPR && !associatedPR.merged_at) return "review";
      if (associatedPR?.merged_at) return "done";
      // Engine reports succeeded but no PR yet — keep visible as building so
      // the user sees the in-flight task instead of it dropping to backlog.
      return "building";
    }
    // status === 'pending' falls through to the legacy heuristics below.
  }

  // -1. Fresh activity overrides terminal state. When the user runs `@kody sync`
  //     or `@kody fix-ci` on a done/failed task, a new workflow dispatches but
  //     the kody:done/failed label persists. The active run is the truer signal.
  if (
    workflowRun?.status === "in_progress" ||
    workflowRun?.status === "queued"
  ) {
    return "building";
  }

  // 0. Terminal lifecycle labels (highest priority)
  if (labelNames.includes("kody:failed")) return "failed";
  if (labelNames.includes("kody:done")) return "done";

  // 1. Review phase — pipeline finished, PR open, awaiting human review
  if (labelNames.includes("kody:reviewing")) return "review";

  // 2. Any other kody:* active phase collapses to the "building" lane
  if (
    labelNames.includes("kody:building") ||
    labelNames.includes("kody:classifying") ||
    labelNames.includes("kody:researching") ||
    labelNames.includes("kody:planning") ||
    labelNames.includes("kody:running") ||
    labelNames.includes("kody:fixing") ||
    labelNames.includes("kody:resolving") ||
    labelNames.includes("kody:syncing") ||
    labelNames.includes("kody:orchestrating")
  ) {
    return "building";
  }

  // 4. (Active workflow handled at step -1; only completed runs reach here.)

  // 5. Explicit state labels (only checked when no active workflow run)
  if (labelNames.includes("failed")) return "failed";
  if (labelNames.includes("gate-waiting")) return "gate-waiting";
  if (labelNames.includes("retrying")) return "retrying";

  // 6. Workflow run completed status
  if (workflowRun?.status === "completed") {
    // Also handle timed_out and cancelled as failures
    if (
      workflowRun.conclusion === "failure" ||
      workflowRun.conclusion === "timed_out" ||
      workflowRun.conclusion === "cancelled"
    )
      return "failed";
  }

  // 7. Associated PR (always fetched via bulk)
  if (associatedPR && !associatedPR.merged_at) {
    // Mid-flow kody:* labels on the PR mean the engine is actively working
    // on it (e.g. @kody fix added kody:fixing). The issue's labels don't
    // change in this case, so without this check the task stays in "review"
    // while kody is in fact rebuilding.
    const prLabels = (associatedPR.labels ?? []).map((l) => l.toLowerCase());
    const prMidFlow = prLabels.some(
      (l) =>
        l === "kody:fixing" ||
        l === "kody:syncing" ||
        l === "kody:resolving" ||
        l === "kody:building" ||
        l === "kody:running" ||
        l === "kody:planning" ||
        l === "kody:classifying" ||
        l === "kody:researching" ||
        l === "kody:orchestrating",
    );
    if (prMidFlow) return "building";
    return "review";
  }

  // 8. Other labels
  if (labelNames.includes("released")) return "done";
  if (labelNames.includes("in-progress") || labelNames.includes("building"))
    return "building";
  if (labelNames.includes("review") || labelNames.includes("pr"))
    return "review";

  // 9. Default to open
  return "open";
}

export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  // Set per-user repo context so github-client uses the correct owner/repo
  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const { searchParams } = new URL(req.url);
    const board = searchParams.get("board") || "all";
    const since = searchParams.get("since") || undefined; // ISO date string, e.g., "2026-02-01"
    // view=running — only return tasks the user can act on (drops `done`/`failed`).
    // Cuts payload size and lets the dashboard's Active tab skip terminal items.
    const view = searchParams.get("view") ?? "all";

    // Date filter presets
    let sinceDate: string | undefined = since;
    if (!sinceDate && searchParams.get("days")) {
      const days = parseInt(searchParams.get("days")!, 10);
      const date = new Date();
      date.setDate(date.getDate() - days);
      sinceDate = date.toISOString();
    }

    // Fetch issues, workflow runs, and open PRs in parallel (3 API calls, all cached)
    const [issues, workflowRuns, openPRs] = await Promise.all([
      fetchIssues({
        state: "open",
        perPage: 100,
        since: sinceDate,
        // The "Kody control" issue is the dashboard's own audit trail for
        // Run now dispatches — infrastructure, not a task. Drop it so it
        // doesn't show up as noise in the task list.
        excludeLabels: ["kody:control"],
      }),
      fetchWorkflowRuns({ perPage: 30 }),
      fetchOpenPRs(),
    ]);

    // Workflow runs are matched per-task below using matchWorkflowRunToTask()
    // which prefers active (in_progress/queued) runs over stale completed ones.

    // Build PR lookup. Primary key: GitHub's structured "Closes #N" links from
    // the PR body (closingIssueNumbers, fetched via GraphQL). Fallbacks: branch
    // name patterns for PRs that don't use a closing keyword.
    const prsByIssueTitle = new Map<string, (typeof openPRs)[number]>();
    const prsByIssueNumber = new Map<number, (typeof openPRs)[number]>();
    // Direct PR-number lookup, used by the kody-release-pr issue-body marker
    // (engine-written, durable across @kody fix on the PR side — see
    // kody2/src/executables/release-{prepare,deploy}/*.sh).
    const prByNumber = new Map<number, (typeof openPRs)[number]>();
    for (const pr of openPRs) prByNumber.set(pr.number, pr);
    for (const pr of openPRs) {
      prsByIssueTitle.set(pr.title, pr);
      for (const linkedIssue of pr.closingIssueNumbers ?? []) {
        prsByIssueNumber.set(linkedIssue, pr);
      }
      // Non-closing references (e.g. release-prepare's `Tracking-Issue: #N`).
      // Lower precedence than closingIssueNumbers — only fills gaps.
      for (const trackedIssue of pr.trackingIssueNumbers ?? []) {
        if (!prsByIssueNumber.has(trackedIssue)) {
          prsByIssueNumber.set(trackedIssue, pr);
        }
      }
      if (
        (pr.closingIssueNumbers?.length ?? 0) > 0 ||
        (pr.trackingIssueNumbers?.length ?? 0) > 0
      ) {
        continue;
      }

      // Fallbacks for PRs without a closing keyword.
      const autoMatch = pr.head.ref.match(/-auto-(\d+)-/);
      if (autoMatch) {
        prsByIssueNumber.set(parseInt(autoMatch[1], 10), pr);
        continue;
      }
      const slashMatch = pr.head.ref.match(/\/(\d{3,})-/);
      if (slashMatch) {
        prsByIssueNumber.set(parseInt(slashMatch[1], 10), pr);
        continue;
      }
      const flatMatch = pr.head.ref.match(/^(\d{3,})-/);
      if (flatMatch) {
        prsByIssueNumber.set(parseInt(flatMatch[1], 10), pr);
        continue;
      }
      // Branch ref is purely the issue number (e.g. kody task PRs use
      // `1453` as the branch). No dash suffix, so the patterns above miss.
      const digitsOnly = pr.head.ref.match(/^(\d{3,})$/);
      if (digitsOnly) {
        prsByIssueNumber.set(parseInt(digitsOnly[1], 10), pr);
        continue;
      }
      // PR title prefixed with `#<num>:` (kody task PR convention).
      // Catches cases where the body lacks a Closes link and the branch
      // isn't a digits-only ref.
      const titleHash = pr.title.match(/^#(\d+):/);
      if (titleHash) {
        prsByIssueNumber.set(parseInt(titleHash[1], 10), pr);
      }
    }

    // Stacked-PR model (engine ≥ 0.4.39): no umbrella issue, no goal branch,
    // no goal PR. Every goal-labelled issue IS a task — paired with its
    // stacked PR via the existing Closes#N / digits-only-branch / "#N:" title
    // heuristics built above. The old umbrella resolution block (which read
    // `state.goalIssueNumber` to skip umbrella rows from pipeline-status
    // fetch and pair them with `goal-<id>` branches) is gone.

    // Fetch Vercel preview URLs for PRs that have them (1 bulk + N status calls, cached)
    const prShas = openPRs.map((pr) => pr.head.sha);
    const previewUrls = await fetchDeploymentPreviews(prShas);
    // Build SHA -> preview URL lookup keyed by PR number for easy access
    const previewByPrNumber = new Map<number, string>();
    for (const pr of openPRs) {
      const url = previewUrls.get(pr.head.sha);
      if (url) {
        previewByPrNumber.set(pr.number, url);
      }
      // No fallback — showing no preview URL is better than a wrong one.
      // The fetchDeploymentPreviews function now handles SHA-based lookups
      // for older deployments that fall outside the bulk fetch window.
    }

    // First pass: match workflow runs once per issue (reused later in the
    // mapping loop) and identify issue numbers that need branch lookup
    // (those with active workflows or pipeline labels). Terminal states
    // (`kody:done`, `kody:failed`) are excluded from branch lookup — their
    // pipeline JSON won't change and re-fetching it on every poll burns
    // rate-limit budget.
    const workflowRunByIssueNumber = new Map<number, WorkflowRun>();
    const activeIssueNumbers: number[] = [];
    for (const issue of issues) {
      const taskId = extractTaskId(issue.title);
      const workflowRun = matchWorkflowRunToTask(
        workflowRuns,
        issue.title,
        issue.number,
        taskId,
      );
      if (workflowRun && issue.number) {
        workflowRunByIssueNumber.set(issue.number, workflowRun);
      }
      const labelNames = issue.labels.map((l) => l.name.toLowerCase());
      // Active workflow run overrides terminal labels — `@kody sync` /
      // `@kody fix-ci` re-trigger work on done/failed tasks without removing
      // the kody:done label, so the running workflow is the truer signal.
      const hasActiveRun =
        workflowRun?.status === "in_progress" ||
        workflowRun?.status === "queued";
      const isTerminal =
        !hasActiveRun &&
        (labelNames.includes("kody:done") ||
          labelNames.includes("kody:failed"));
      const isLikelyActive =
        !isTerminal &&
        (hasActiveRun || labelNames.some((n) => n.startsWith("kody:")));

      if (isLikelyActive && issue.number) {
        activeIssueNumbers.push(issue.number);
      }
    }

    // Batch fetch branches for all active issues (5 GitHub API calls max, not 5*N)
    const branchByIssueNumber =
      await findBranchesByIssueNumbers(activeIssueNumbers);

    // Batch fetch canonical kody state for any engine-touched issue.
    // Two signals indicate the engine wrote a state comment:
    //   1. A `kody:*` label — engine reached the label-application stage.
    //   2. A matched kody workflow run — engine *started* on this issue,
    //      even if the run was cancelled before labels landed (e.g. a
    //      concurrency-loser). Without this, an issue whose chain died
    //      from a concurrency cancel never gets its state read; column
    //      derivation falls to step 6 and treats the cancelled run as a
    //      build failure even though the engine recorded `status: running`.
    // Terminal (kody:done/failed) issues are included on purpose — that's
    // exactly where the user wants to see the recorded state (failure
    // reason on failed, last action on done). Reuses fetchComments' ETag
    // cache, so polling cost is effectively zero (304 hits).
    const kodyTouchedIssueNumbers = issues
      .filter(
        (i) =>
          i.labels.some((l) => l.name.toLowerCase().startsWith("kody:")) ||
          (typeof i.number === "number" &&
            workflowRunByIssueNumber.has(i.number)),
      )
      .map((i) => i.number)
      .filter((n): n is number => typeof n === "number" && n > 0);
    const kodyStateByIssueNumber = new Map<number, KodyTaskState>();
    await Promise.all(
      kodyTouchedIssueNumbers.map(async (n) => {
        const state = await fetchKodyState(n);
        if (state) kodyStateByIssueNumber.set(n, state);
      }),
    );

    // Parse issues into tasks with additional metadata
    const tasks: KodyTask[] = await Promise.all(
      issues.map(async (issue) => {
        // Extract a real kody task ID (e.g. "260224-auto-38"). Priority
        // brackets like "[P2]" don't qualify — see extractTaskId comment.
        const taskId = extractTaskId(issue.title);

        // Match workflow run — computed once in the first pass and reused
        // here. `matchWorkflowRunToTask` prefers active (in_progress) runs
        // over stale completed ones.
        const workflowRun = issue.number
          ? (workflowRunByIssueNumber.get(issue.number) ?? null)
          : null;

        // Match PR. Highest priority: engine-written `<!-- kody-release-pr: #N -->`
        // marker in the issue body (release-prepare/deploy persist this so the
        // link survives @kody fix overwriting the PR body). Falls back to
        // closing/tracking refs and branch heuristics from the bulk PR list.
        let pr: (typeof openPRs)[number] | null = null;
        const releaseMarker = issue.body
          ? issue.body.match(/<!--\s*kody-release-pr:\s*#?(\d+)\s*-->/i)
          : null;
        if (releaseMarker) {
          const markedPr = prByNumber.get(parseInt(releaseMarker[1]!, 10));
          if (markedPr) pr = markedPr;
        }
        if (!pr) {
          pr =
            prsByIssueTitle.get(issue.title) ??
            prsByIssueNumber.get(issue.number) ??
            null;
        }

        // Fetch pipeline status for tasks with active workflows or pipeline labels.
        // Uses pre-fetched branch map (batch call above) instead of per-task API calls.
        // Terminal states (`kody:done`, `kody:failed`) are skipped — pipeline JSON
        // is settled and re-reading it on every poll wastes the rate-limit budget.
        let pipelineStatus = undefined;
        const labelNames = issue.labels.map((l) => l.name.toLowerCase());
        // Same logic as the branch-lookup pass: an in-flight run trumps the
        // kody:done/failed label so sync/fix-ci progress shows up immediately.
        const hasActiveRun =
          workflowRun?.status === "in_progress" ||
          workflowRun?.status === "queued";
        const isTerminal =
          !hasActiveRun &&
          (labelNames.includes("kody:done") ||
            labelNames.includes("kody:failed"));
        const isLikelyActive =
          !isTerminal &&
          (hasActiveRun ||
            labelNames.includes("kody:building") ||
            labelNames.includes("kody:planning") ||
            labelNames.includes("hard-stop") ||
            labelNames.includes("risk-gated"));

        if (isLikelyActive && issue.number) {
          const branch = branchByIssueNumber.get(issue.number);
          if (branch) {
            // First try with known taskId from title brackets (fast, exact path)
            let status: Awaited<ReturnType<typeof getStatusFromBranch>> = null;
            if (taskId) {
              status = await getStatusFromBranch(taskId, branch);
            }
            // Fallback: discover task ID by scanning .tasks/ directory on the branch.
            // Pipeline generates random task IDs (e.g., 260306-auto-330) that don't
            // match the issue number, so we need to discover the actual directory.
            if (!status) {
              status = await findStatusOnBranch(branch, issue.number);
            }
            if (status) pipelineStatus = status;
          }
        }

        // Column derivation: pipeline status is authoritative when fresh,
        // falling back to label-based derivation. Exception: when a new
        // workflow run is in-flight (sync/fix-ci) but the cached pipeline
        // JSON still reflects the previous completed/failed run, prefer the
        // active workflow signal so the task moves back to "building".
        //
        // Closed-state short-circuit: a manually-closed issue is terminal
        // regardless of stale `kody:planning`/`kody:building` labels or an
        // open PR. Without this, closed tasks leak into the Running view
        // (column='building'/'review') or stay in Backlog (column='open').
        const pipelineLooksStale =
          pipelineStatus &&
          (pipelineStatus.state === "completed" ||
            pipelineStatus.state === "failed" ||
            pipelineStatus.state === "timeout") &&
          (workflowRun?.status === "in_progress" ||
            workflowRun?.status === "queued");
        const kodyState = kodyStateByIssueNumber.get(issue.number) ?? null;
        const column: ColumnId =
          issue.state === "closed"
            ? "done"
            : pipelineStatus && !pipelineLooksStale
              ? deriveColumnFromPipeline(pipelineStatus)
              : pipelineLooksStale
                ? "building"
                : getColumnForIssue(
                    issue,
                    workflowRun ?? undefined,
                    pr ?? null,
                    kodyState,
                  );

        // Derive gate type: prefer pipeline controlMode, fall back to issue labels
        const gateType = deriveGateType(pipelineStatus);
        const taskLabels = issue.labels.map((l) => l.name);

        return {
          id: taskId ? `${taskId}-${issue.number}` : issue.number.toString(),
          issueNumber: issue.number,
          title: issue.title,
          body: issue.body || "",
          state: issue.state,
          labels: taskLabels,
          column,
          kodyPhase: parseKodyPhase(taskLabels),
          kodyFlow: parseKodyFlow(taskLabels),
          createdAt: issue.created_at,
          updatedAt: issue.updated_at,
          pipeline: pipelineStatus,
          workflowRun: workflowRun
            ? {
                id: workflowRun.id,
                status: workflowRun.status,
                conclusion: workflowRun.conclusion,
                created_at: workflowRun.created_at,
                updated_at: workflowRun.updated_at,
                html_url: workflowRun.html_url,
              }
            : undefined,
          associatedPR: pr
            ? {
                id: pr.id,
                number: pr.number,
                title: pr.title,
                state: pr.state,
                head: pr.head,
                merged_at: pr.merged_at,
                html_url: pr.html_url,
                // CI rollup is now folded into fetchOpenPRs — pass through so
                // CIStatusBadge / merge button can read it without a per-PR fetch.
                ciStatus: pr.ciStatus,
                mergeable: pr.mergeable,
                hasConflicts: pr.hasConflicts,
              }
            : null,
          assignees: issue.assignees,
          isKodyAssigned: issue.isKodyAssigned,
          previewUrl: pr ? previewByPrNumber.get(pr.number) : undefined,
          // Substatus from labels and workflow run data
          isTimeout: workflowRun?.conclusion === "timed_out",
          gateType,
          kodyState: kodyState ?? undefined,
          // Surface the failure reason inline on failed tasks. The engine
          // records it in lastOutcome.payload.reason; truncate so the task
          // card doesn't blow up the layout.
          failureReason:
            column === "failed" && kodyState?.core.lastOutcome?.payload?.reason
              ? truncateReason(
                  String(kodyState.core.lastOutcome.payload.reason),
                )
              : undefined,
        };
      }),
    );

    // Filter by board if needed
    let filteredTasks = tasks;
    if (board !== "all") {
      if (board.startsWith("label:")) {
        const label = board.replace("label:", "");
        filteredTasks = tasks.filter((t) => t.labels.includes(label));
      } else if (board.startsWith("milestone:")) {
        // Would need to filter by milestone - for now just return all
        filteredTasks = tasks;
      }
    }

    // view=running drops terminal tasks from the response so the Active tab
    // doesn't ship them over the wire on every poll. Backlog (`open` column)
    // is also dropped — the Active tab is for in-flight work only.
    if (view === "running") {
      filteredTasks = filteredTasks.filter(
        (t) =>
          t.column !== "done" && t.column !== "failed" && t.column !== "open",
      );
    } else if (view === "backlog") {
      filteredTasks = filteredTasks.filter((t) => t.column === "open");
    }

    return NextResponse.json({ tasks: filteredTasks });
  } catch (error: any) {
    console.error("[Kody] Error fetching tasks:", error);

    // Check for rate limiting (403 from GitHub)
    const isRateLimited =
      error?.status === 403 ||
      error?.message?.includes("rate limit") ||
      error?.response?.headers?.["x-ratelimit-remaining"] === "0";

    if (isRateLimited) {
      const resetTime = error?.response?.headers?.["x-ratelimit-reset"];
      const resetDate = resetTime ? new Date(parseInt(resetTime) * 1000) : null;
      const retryAfter = resetDate
        ? Math.ceil((resetDate.getTime() - Date.now()) / 1000 / 60)
        : null;

      return NextResponse.json(
        {
          error: "rate_limited",
          message: "GitHub API rate limit exceeded",
          retryAfter: retryAfter ? `${retryAfter} minutes` : "unknown",
          resetTime: resetDate?.toISOString() || null,
        },
        { status: 429 },
      );
    }

    // Check for missing token - match both old and new error message formats from getOctokit()
    // Old: "GITHUB_TOKEN not configured"
    // New: "Neither KODY_BOT_TOKEN nor GITHUB_TOKEN is configured"
    // Both contain "TOKEN" and "configured"
    const isNoTokenError =
      error?.message?.includes("TOKEN") &&
      error?.message?.includes("configured") &&
      (error?.message?.includes("GITHUB_TOKEN") ||
        error?.message?.includes("KODY_BOT_TOKEN"));

    if (isNoTokenError) {
      return NextResponse.json(
        {
          error: "no_token",
          message:
            "GitHub token is not configured. Set GITHUB_TOKEN, KODY_BOT_TOKEN, or GH_PAT in environment variables.",
        },
        { status: 401 },
      );
    }

    // Return empty state for other errors instead of mock data
    return NextResponse.json({
      tasks: [],
      error: error?.message || "Failed to fetch tasks",
    });
  } finally {
    clearGitHubContext();
  }
}

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  // Set per-user repo context so github-client uses the correct owner/repo
  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  // Zod validation schema for POST body
  const createTaskSchema = z.object({
    title: z.string().min(1),
    body: z.string().optional(),
    labels: z.array(z.string()).optional(),
    assignees: z.array(z.string()).optional(),
    attachments: z
      .array(
        z.object({
          name: z.string(),
          content: z.string(),
        }),
      )
      .optional(),
    actorLogin: z.string().optional(),
    autoTrigger: z.boolean().optional().default(true),
  });

  try {
    const body = await req.json();

    // Validate with Zod
    const validated = createTaskSchema.parse(body);

    const {
      title,
      body: issueBody,
      labels,
      assignees,
      attachments,
      actorLogin,
      autoTrigger,
    } = validated;

    // Verify actorLogin matches the authenticated session (prevents impersonation)
    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;
    const { identity } = actorResult;

    // Use verified identity's login for attribution
    const verifiedLogin = identity.login;

    // Get user's Octokit (null for legacy sessions → falls back to bot token)
    const userOctokit = await getUserOctokit(req);

    // Create the issue in GitHub — when user token is available, issue appears under their identity
    const actorNote = userOctokit
      ? ""
      : `\n\n---\n_Created by @${verifiedLogin} via Kody dashboard_`;
    // Default assignee to the initiating user when the caller didn't specify one.
    const resolvedAssignees =
      assignees && assignees.length > 0 ? assignees : [verifiedLogin];
    const issue = await createIssue(
      {
        title,
        body: (issueBody || "") + actorNote,
        labels: labels || [],
        assignees: resolvedAssignees,
      },
      userOctokit ?? undefined,
    );

    console.log("[Kody] Created issue:", issue.number, issue.title);

    // Auto-trigger pipeline by commenting @kody on the issue
    // Skipped when caller opts out (e.g., the chat auto-creates a task purely
    // as a session anchor and should NOT kick off the Kody pipeline).
    if (autoTrigger) {
      try {
        await postComment(issue.number, "@kody", userOctokit ?? undefined);
        console.log("[Kody] Triggered pipeline for issue:", issue.number);
      } catch (triggerError: any) {
        console.error(
          "[Kody] Failed to trigger pipeline:",
          triggerError.message,
        );
        // Don't fail the whole request if trigger fails - task was still created
      }
    } else {
      console.log(
        "[Kody] autoTrigger=false; skipping @kody comment for issue:",
        issue.number,
      );
    }

    // Upload attachments if provided
    const uploadedAttachments = [];
    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      console.log("[Kody] Uploading", attachments.length, "attachments...");
      for (const attachment of attachments) {
        try {
          const result = await uploadIssueAttachment(
            issue.number,
            {
              name: attachment.name,
              content: attachment.content,
            },
            userOctokit ?? undefined,
          );
          uploadedAttachments.push(result);
          console.log(
            "[Kody] Uploaded attachment:",
            result.name,
            result.attachment_url,
          );
        } catch (attachError: any) {
          console.error(
            "[Kody] Failed to upload attachment:",
            attachError.message,
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      issue: {
        number: issue.number,
        title: issue.title,
        html_url: issue.html_url,
      },
      attachments: uploadedAttachments,
    });
  } catch (error: any) {
    console.error("[Kody] Error creating task:", error);

    // Handle ZodError specifically - return 400 for validation errors
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.issues },
        { status: 400 },
      );
    }

    // User's GitHub token expired/revoked — prompt re-auth
    if (error.status === 401) {
      return NextResponse.json(
        {
          error: "github_token_expired",
          message: "Your GitHub token has expired. Please log in again.",
        },
        { status: 401 },
      );
    }

    return NextResponse.json(
      { error: "Failed to create task", details: error.message },
      { status: 500 },
    );
  }
}
