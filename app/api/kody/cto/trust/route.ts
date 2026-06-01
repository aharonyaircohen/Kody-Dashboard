/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern cto-trust-management
 * @ai-summary GET/POST /api/kody/cto/trust — the read + management surface for
 *   the staff trust ledger (`kody:cto-decisions`), powering the /trust page.
 *
 *   GET  → the full per-staff trust stats (`staff[slug][action]`) plus the
 *          recent decision log. Cached read (ETag/304) per CLAUDE.md rate rule.
 *   POST → an operator override of one action's autonomy:
 *            { staff, action, op: "reset" | "graduate" | "degrade" }
 *          Applies the matching pure transform from `trust-ops` through the
 *          CAS mutator, records an audit entry, and returns the new stats.
 *
 *   Unlike `/cto/decision`, this NEVER posts an `@kody` command — it only
 *   rewrites trust state. Graduating an action is what lets the engine stop
 *   asking; degrading is the manual kill switch.
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
} from "@dashboard/lib/github-client";
import {
  mutateCtoDecisions,
  readCtoDecisions,
} from "@dashboard/lib/cto/decisions-server";
import { applyTrustOp, TRUST_OPS } from "@dashboard/lib/cto/trust-ops";
import { recordAudit } from "@dashboard/lib/activity/audit";

const bodySchema = z.object({
  staff: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/i),
  action: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/i),
  op: z.enum(TRUST_OPS),
  actorLogin: z.string().optional(),
});

/** GET — full trust stats + recent log for the /trust page. */
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
    return NextResponse.json({ staff: manifest.staff, log: manifest.log });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "read failed";
    return NextResponse.json(
      { error: "trust_read_failed", message },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

/** POST — apply one trust override (reset / graduate / degrade). */
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

    const { staff, action, op, actorLogin } = payload;

    if (actorLogin) {
      const actorResult = await verifyActorLogin(req, actorLogin);
      if (actorResult instanceof NextResponse) return actorResult;
    }

    // Writing the ledger issue requires a signed-in token — same gate as
    // editing a duty. Falls through to the request context token otherwise.
    const userOctokit = (await getUserOctokit(req)) ?? undefined;

    const { manifest } = await mutateCtoDecisions(
      (current) => ({
        next: applyTrustOp(current, op, staff, action),
        result: null,
      }),
      { userOctokit },
    );

    // No explicit cache bust needed: the CAS mutator re-reads the ledger issue
    // with `noCache` as its write-verify step, so the in-process cache already
    // holds the new state for the next GET (CLAUDE.md rate-limit rule 5).
    recordAudit(req, {
      action: `trust.${op}`,
      resource: `${staff}:${action}`,
      staff,
      detail: `${op} trust for ${staff} · ${action}`,
    });

    return NextResponse.json({
      ok: true,
      staff,
      action,
      op,
      stats: manifest.staff[staff]?.[action] ?? null,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to update trust";
    console.error("[cto/trust] failed", err);
    return NextResponse.json(
      { error: "trust_update_failed", message },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
