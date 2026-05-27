/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern cto-decision
 * @ai-summary POST /api/kody/cto/decision — the operator's one-tap verdict
 *   on a CTO recommendation surfaced in the inbox.
 *
 *   `approve` → triggers the recommended action for *dispatchable* verbs
 *   (`execute`/`fix`, which post `@kody` on the task issue — the engine's
 *   single write path, via the shared `postWithFallback` helper). For
 *   non-dispatchable verbs (`qa-review`/`approve`/`comment`) there is no
 *   dashboard executor, so approve only records the verdict — it never
 *   silently reroutes to `@kody`. Either way the verdict lands in the
 *   `kody:cto-decisions` ledger.
 *
 *   `reject` → records the rejection only (and resets that action's
 *   consecutive-approval streak, so a single "no" blocks graduation).
 *
 *   `dismiss` → records a neutral verdict only. Drains the inbox
 *   backpressure slot (the entry is now "decided") **without** touching
 *   approvals/rejections/streak/mode — for clearing stale recs the
 *   operator doesn't want to act on but also doesn't want to penalise
 *   the CTO over. Never dispatches a command.
 *
 *   The ledger is what makes automation *evolve*: Phase 2 has the CTO read
 *   it each tick and stop asking once an action clears the trust threshold.
 */
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
  invalidateTaskCache,
  invalidateIssueCache,
  getOctokit,
} from "@dashboard/lib/github-client";
import { postWithFallback } from "@dashboard/lib/kody-command";
import { attemptSquashMerge, isMerged } from "@dashboard/lib/kody/squash-merge";
import {
  mutateCtoDecisions,
  readCtoDecisions,
} from "@dashboard/lib/cto/decisions-server";
import {
  applyDecision,
  latestCtoDecisions,
  DEFAULT_STAFF_SLUG,
} from "@dashboard/lib/cto/decisions";
import {
  CTO_ACTIONS,
  isDispatchable,
  isDashboardAction,
  dispatchCommand,
  isNonEngineCommand,
} from "@dashboard/lib/cto/recommendation";

const bodySchema = z.object({
  taskNumber: z.number().int().positive(),
  action: z.enum(CTO_ACTIONS).default("execute"),
  decision: z.enum(["approve", "reject", "dismiss"]),
  /**
   * Slug of the staff member whose rec this verdict decides. Scopes the trust
   * ledger per staff. Defaults to the CTO so legacy clients (which don't send
   * it) keep landing under the CTO's ledger slice.
   */
  staff: z
    .string()
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/i)
    .default(DEFAULT_STAFF_SLUG),
  actorLogin: z.string().optional(),
  /**
   * The exact `@kody …` command to post on approve, as parsed from the
   * CTO's own `kody-cmd` line. Server-side guards still apply (must start
   * with `@kody`, ≤300 chars); falls back to the legacy verb→command map
   * when absent so older recs stay actionable.
   */
  command: z.string().max(300).optional(),
});

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    let payload: z.infer<typeof bodySchema>;
    try {
      payload = bodySchema.parse(await req.json());
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json(
          { error: "validation_error", details: err.issues },
          { status: 400 },
        );
      }
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    const { taskNumber, action, decision, actorLogin, staff } = payload;
    const requested = payload.command?.trim();

    if (actorLogin) {
      const actorResult = await verifyActorLogin(req, actorLogin);
      if (actorResult instanceof NextResponse) return actorResult;
    }

    const userOctokit = (await getUserOctokit(req)) ?? undefined;

    // Approve → run the recommended action before recording, so a failed
    // dispatch/merge doesn't get logged as a trusted approval.
    let executed = false;

    if (decision === "approve" && isDashboardAction(action)) {
      // `merge`: the dashboard squash-merges the PR itself (the engine never
      // auto-merges). The rec's taskNumber IS the PR number (the QA-verify
      // duty posts the rec on the PR). A blocked merge (CI/conflict) returns
      // 409 BEFORE recording, so it never counts toward the trust streak.
      const mergeOctokit = userOctokit ?? getOctokit();
      const outcome = await attemptSquashMerge(mergeOctokit, taskNumber);
      if (!isMerged(outcome)) {
        return NextResponse.json(
          {
            error: "merge_blocked",
            outcome: outcome.kind,
            message: `Merge of PR #${taskNumber} did not succeed (${outcome.kind}); not recorded as approved.`,
          },
          { status: 409 },
        );
      }
      executed = true;
      invalidateIssueCache(taskNumber);
      invalidateTaskCache();
    } else {
      // The CTO's own command wins (guarded: must be a single `@kody …`, and
      // not a non-engine verb like `@kody approve` — those make the engine
      // reply "I don't recognize approve", so we drop them to the verb→command
      // fallback rather than posting a dead command). Legacy recs with no
      // command fall back to the verb→command map.
      const resolved =
        requested &&
        requested.startsWith("@kody") &&
        !requested.includes("\n") &&
        !isNonEngineCommand(requested)
          ? requested
          : isDispatchable(action)
            ? dispatchCommand(action)
            : null;
      const command = decision === "approve" ? resolved : null;
      if (command) {
        // Each action maps to the exact engine command: `execute`/`fix` →
        // `@kody` (for `fix` the QA-failure comment is already in-thread, so
        // re-dispatching IS the fix); `qa-review` → `@kody ui-review`.
        // Non-dispatchable verbs never reach here — recorded only, never
        // rerouted.
        await postWithFallback(taskNumber, command, actorLogin, userOctokit);
        executed = true;
        // The task issue just got a comment, and the task list view may
        // change — invalidate both per CLAUDE.md rate-limit rule 5.
        invalidateIssueCache(taskNumber);
        invalidateTaskCache();
      }
    }

    const { manifest } = await mutateCtoDecisions(
      (current) => ({
        next: applyDecision(current, {
          staff,
          taskNumber,
          action,
          decision,
          ...(actorLogin ? { by: actorLogin } : {}),
        }),
        result: null,
      }),
      { userOctokit },
    );

    return NextResponse.json({
      ok: true,
      executed,
      staff,
      action,
      decision,
      stats: manifest.staff[staff]?.[action] ?? null,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to record CTO decision";
    console.error("[cto/decision] failed", err);
    return NextResponse.json(
      { error: "decision_failed", message },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

/**
 * GET /api/kody/cto/decision — the latest verdict per task+action, so the
 * inbox can render a verdict badge instead of Approve/Reject for
 * recommendations that were already decided (on any device). Cached read
 * (ETag/304); POST invalidates the ledger issue so this stays fresh.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  try {
    const manifest = await readCtoDecisions();
    return NextResponse.json({ decided: latestCtoDecisions(manifest) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "read failed";
    return NextResponse.json(
      { error: "decisions_read_failed", message },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
