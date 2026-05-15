/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern approve-gate
 * @ai-summary Approve a gate — atomic merge-then-cleanup.
 *
 *   The flow is: APPROVE review → MERGE squash → IF merge succeeded
 *   THEN delete branch + close issue. If the merge fails for any reason
 *   other than "already merged", we return 409 with a structured error
 *   code and DO NOT touch the branch or issue. Previously this endpoint
 *   silently swallowed merge failures and ran delete+close anyway —
 *   that path destroyed work (branch deleted, PR auto-closed without
 *   merge, issue closed) and the dashboard still reported success.
 *
 *   Caught by tests/e2e/vibe-live-full-flow.spec.ts step 12 — the test
 *   merges a real PR with `unstable` CI and asserted `merged === true`
 *   on GitHub, exposing the silent-swallow.
 *
 *   Uses per-user GitHub token when available for proper attribution.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import {
  requireKodyAuth,
  verifyActorLogin,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import {
  getOctokit,
  setGitHubContext,
  clearGitHubContext,
  getOwner,
  getRepo,
} from "@dashboard/lib/github-client";
import { isProtectedBranch } from "@dashboard/lib/branches";

const ApproveRequestSchema = z.object({
  issueNumber: z.number().int().positive(),
  prNumber: z.number().int().positive(),
  branchName: z.string().optional(),
  actorLogin: z.string().optional(),
});

type MergeOutcome =
  | { kind: "merged" }
  | { kind: "already-merged" }
  | { kind: "failed-ci" }
  | { kind: "failed-conflict" }
  | { kind: "failed-other"; message: string; status?: number };

async function attemptSquashMerge(
  octokit: Octokit,
  prNumber: number,
): Promise<MergeOutcome> {
  try {
    await octokit.pulls.merge({
      owner: getOwner(),
      repo: getRepo(),
      pull_number: prNumber,
      merge_method: "squash",
    });
    return { kind: "merged" };
  } catch (err) {
    const e = err as { status?: number; message?: string };
    const msg = e.message ?? "";
    // GitHub returns 405 for non-mergeable (CI failing, branch protection,
    // mergeable_state is "blocked" / "behind" / "dirty"). 422 for conflicts.
    // We classify so the caller (and the dashboard UI) can show the right
    // message instead of a generic 500.
    if (msg.includes("already merged") || msg.includes("Already up to date")) {
      return { kind: "already-merged" };
    }
    if (msg.includes("not mergeable") || e.status === 405) {
      return { kind: "failed-ci" };
    }
    if (e.status === 409 || /conflict/i.test(msg)) {
      return { kind: "failed-conflict" };
    }
    return { kind: "failed-other", message: msg, status: e.status };
  }
}

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const body = await req.json();
    const parsed = ApproveRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { issueNumber, prNumber, branchName, actorLogin } = parsed.data;

    const actorResult = await verifyActorLogin(req, actorLogin);
    if (actorResult instanceof NextResponse) return actorResult;
    const { identity } = actorResult;
    const verifiedLogin = identity.login;

    const userOctokit = await getUserOctokit(req);
    const octokit = userOctokit ?? getOctokit();
    const results: string[] = [];

    // 1. Approve the PR review (best-effort — failure here means already
    //    approved or insufficient permission; not a blocker for the merge
    //    itself, which uses its own auth).
    try {
      await octokit.pulls.createReview({
        owner: getOwner(),
        repo: getRepo(),
        pull_number: prNumber,
        event: "APPROVE",
        body: `✅ Gate approved by @${verifiedLogin} via Kody dashboard.`,
      });
    } catch {
      // already approved / can't self-approve own PR / insufficient perms
    }

    // 2. Attempt the squash merge — this is the gate. If merge does NOT
    //    succeed, we return early and DO NOT touch the branch or issue.
    const outcome = await attemptSquashMerge(octokit, prNumber);
    if (outcome.kind === "failed-ci") {
      return NextResponse.json(
        {
          error: "merge_blocked_ci",
          message:
            `PR #${prNumber} cannot be merged — CI checks are failing or ` +
            "branch protection requires more reviews. Branch and issue " +
            "left intact.",
        },
        { status: 409 },
      );
    }
    if (outcome.kind === "failed-conflict") {
      return NextResponse.json(
        {
          error: "merge_blocked_conflict",
          message:
            `PR #${prNumber} has merge conflicts with the base branch. ` +
            "Resolve conflicts before approving again. Branch and issue " +
            "left intact.",
        },
        { status: 409 },
      );
    }
    if (outcome.kind === "failed-other") {
      return NextResponse.json(
        {
          error: "merge_failed",
          message: `PR #${prNumber} merge failed: ${outcome.message}`,
          status: outcome.status,
        },
        { status: outcome.status === 401 ? 401 : 502 },
      );
    }
    results.push(
      outcome.kind === "merged"
        ? `Merged PR #${prNumber}`
        : `PR #${prNumber} was already merged`,
    );

    // From here on: merge confirmed. Branch delete + issue close run only
    // if the merge actually happened.

    // 3. Delete the work branch (skip protected names; idempotent — a
    //    422 "Reference does not exist" means it was already cleaned up).
    if (branchName && !isProtectedBranch(branchName)) {
      try {
        await octokit.git.deleteRef({
          owner: getOwner(),
          repo: getRepo(),
          ref: `heads/${branchName}`,
        });
        results.push(`Deleted branch ${branchName}`);
      } catch (error: unknown) {
        const e = error as { status?: number; message?: string };
        if (e.status === 422) {
          results.push(`Branch ${branchName} was already deleted`);
        } else {
          // Don't fail the request — branch cleanup is post-merge bookkeeping;
          // the user-visible work (merge) already succeeded.
          const msg = e.message ?? String(error);
          results.push(`Branch ${branchName} delete warning: ${msg}`);
        }
      }
    }

    // 4. Close the linked issue. GitHub usually auto-closes via "Closes #N"
    //    in the PR body once the merge lands, but we close explicitly so
    //    the UI is deterministic.
    try {
      await octokit.issues.update({
        owner: getOwner(),
        repo: getRepo(),
        issue_number: issueNumber,
        state: "closed",
      });
      results.push(`Closed issue #${issueNumber}`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      results.push(`Issue close warning: ${msg}`);
    }

    return NextResponse.json({ success: true, results });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Kody] Approve error:", msg);

    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status?: number }).status === 401
    ) {
      return NextResponse.json(
        {
          error: "github_token_expired",
          message: "Your GitHub token has expired. Please log in again.",
        },
        { status: 401 },
      );
    }

    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    clearGitHubContext();
  }
}
