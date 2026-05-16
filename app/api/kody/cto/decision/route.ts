/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern cto-decision
 * @ai-summary POST /api/kody/cto/decision — the operator's one-tap verdict
 *   on a CTO recommendation surfaced in the inbox.
 *
 *   `approve` → triggers the recommended action (Phase 1: only `execute`,
 *   which posts `@kody` on the task issue — the exact same path as the
 *   Tasks "execute" action, via the shared `postWithFallback` helper) and
 *   records the approval in the `kody:cto-decisions` ledger.
 *
 *   `reject` → records the rejection only (and resets that action's
 *   consecutive-approval streak, so a single "no" blocks graduation).
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
} from "@dashboard/lib/github-client";
import { postWithFallback } from "@dashboard/lib/kody-command";
import { mutateCtoDecisions } from "@dashboard/lib/cto/decisions-server";
import { applyDecision } from "@dashboard/lib/cto/decisions";

// Phase 1 only graduates `execute`. Other actions can be approved/rejected
// (recorded) but the closed set guards against typo'd or unsupported verbs.
const SUPPORTED_ACTIONS = ["execute"] as const;

const bodySchema = z.object({
  taskNumber: z.number().int().positive(),
  action: z.enum(SUPPORTED_ACTIONS).default("execute"),
  decision: z.enum(["approve", "reject"]),
  actorLogin: z.string().optional(),
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

    const { taskNumber, action, decision, actorLogin } = payload;

    if (actorLogin) {
      const actorResult = await verifyActorLogin(req, actorLogin);
      if (actorResult instanceof NextResponse) return actorResult;
    }

    const userOctokit = (await getUserOctokit(req)) ?? undefined;

    // Approve → run the recommended action before recording, so a failed
    // dispatch doesn't get logged as a trusted approval.
    let executed = false;
    if (decision === "approve") {
      if (action === "execute") {
        await postWithFallback(taskNumber, "@kody", actorLogin, userOctokit);
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
      action,
      decision,
      stats: manifest.actions[action] ?? null,
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
