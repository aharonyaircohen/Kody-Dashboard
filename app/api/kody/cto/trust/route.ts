/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern agentResponsibility-trust-management
 * @ai-summary GET/POST /api/kody/cto/trust — read + management surface for the
 *   agentResponsibility-keyed trust ledger, stored as a JSON file in the configured Kody state repo
 *   (`state/trust.json`), NOT an issue. Powers the /trust page.
 *
 *   GET  → the full per-agentResponsibility trust stats (`agentResponsibilities[slug][action]`) + recent log.
 *   POST → an operator override of one agentResponsibility's action autonomy:
 *            { agentResponsibility, action, op: "reset" | "graduate" | "degrade" }
 *          Applies the matching pure transform from `trust-state` through the
 *          file CAS mutator, records an audit entry, returns the new stats.
 *
 *   This never posts an `@kody` command — it only rewrites trust state.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  verifyActorLogin,
  getRequestAuth,
} from "@dashboard/lib/auth";
import {
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import { readTrust, mutateTrust } from "@dashboard/lib/cto/trust-store";
import { applyTrustOp, TRUST_OPS } from "@dashboard/lib/cto/trust-state";
import { recordAudit } from "@dashboard/lib/activity/audit";

const bodySchema = z.object({
  agentResponsibility: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/i),
  op: z.enum(TRUST_OPS),
  actorLogin: z.string().optional(),
});

/** GET — full agentResponsibility trust stats + recent log for the /trust page. */
export async function GET(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  try {
    const manifest = await readTrust();
    return NextResponse.json({
      agentResponsibilities: manifest.agentResponsibilities,
      log: manifest.log,
    });
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

/** POST — apply one trust override (reset / graduate / degrade) to a agentResponsibility. */
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

    const { agentResponsibility, op, actorLogin } = payload;

    if (actorLogin) {
      const actorResult = await verifyActorLogin(req, actorLogin);
      if (actorResult instanceof NextResponse) return actorResult;
    }

    const manifest = await mutateTrust((current) =>
      applyTrustOp(current, op, agentResponsibility),
    );

    recordAudit(req, {
      action: `trust.${op}`,
      resource: agentResponsibility,
      agentResponsibility,
      detail: `${op} trust for ${agentResponsibility}`,
    });

    return NextResponse.json({
      ok: true,
      agentResponsibility,
      op,
      stats: manifest.agentResponsibilities[agentResponsibility] ?? null,
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
