/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern operators-api
 * @ai-summary Company operators API. GET lists `github.operators` from the
 *   connected repo's kody.config.json — the GitHub logins recommendation
 *   duties (pr-health/CTO) @-mention so their comments route into the
 *   dashboard inbox. PUT replaces the list (company-set, explicit — never
 *   auto-filled). Empty list = recommendations reach no inbox, which the UI
 *   surfaces as a warning. Mirrors the models route auth pattern.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  verifyActorLogin,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import { readOperators, writeOperators } from "@dashboard/lib/engine/config";
import { logger } from "@dashboard/lib/logger";

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const octokit = await getUserOctokit(req);
  if (!octokit)
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });

  try {
    const operators = await readOperators(octokit, auth.owner, auth.repo);
    return NextResponse.json({ operators });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "operators: read failed",
    );
    return NextResponse.json(
      { error: "operators_read_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}

const PutSchema = z.object({
  // Up to 50 handles, each a plausible GitHub login (1–39 chars,
  // alphanumeric or single hyphens) with an optional leading `@` the
  // normalizer strips. Bound the size so a fat-fingered paste can't bloat
  // the config blob.
  operators: z.array(z.string().max(40)).max(50),
  actorLogin: z.string().optional(),
});

export async function PUT(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const verify = await verifyActorLogin(req, parsed.data.actorLogin);
  if ("status" in verify) return verify;
  const actorLogin = verify.identity.login;

  const octokit = await getUserOctokit(req);
  if (!octokit)
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });

  try {
    const { operators } = await writeOperators(
      octokit,
      auth.owner,
      auth.repo,
      parsed.data.operators,
      `chore(kody): set operators (${actorLogin})`,
    );
    return NextResponse.json({ operators });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "operators: write failed",
    );
    if ((err as { status?: number })?.status === 401) {
      return NextResponse.json(
        { error: "github_token_expired" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: "operators_write_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
