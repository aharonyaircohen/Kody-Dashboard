/**
 * @fileType api-endpoint
 * @domain variables
 * @pattern variables-api
 * @ai-summary GET — list all variables (name, value, meta). POST — upsert
 *   a variable { name, value }. Unlike secrets, values are returned because
 *   variables are non-sensitive config (model lists, feature flags, etc).
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
  invalidateVariablesCache,
  listVariables,
  readVariables,
  writeVariables,
  type VariablesDocument,
} from "@dashboard/lib/variables/store";
import { logger } from "@dashboard/lib/logger";

const NAME_RE = /^[A-Z][A-Z0-9_]{0,127}$/;

const UpsertSchema = z.object({
  name: z.string().regex(NAME_RE, {
    message:
      "Name must be uppercase letters, digits, underscores; start with a letter; ≤128 chars.",
  }),
  value: z
    .string()
    .min(1, { message: "Value cannot be empty" })
    .max(64 * 1024),
  actorLogin: z.string().optional(),
});

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
    const { doc } = await readVariables(octokit, auth.owner, auth.repo);
    return NextResponse.json({ variables: listVariables(doc) });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "variables: list failed",
    );
    return NextResponse.json(
      { error: "variables_read_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
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

  const parsed = UpsertSchema.safeParse(body);
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
    const { doc, sha } = await readVariables(octokit, auth.owner, auth.repo, {
      force: true,
    });
    const next: VariablesDocument = {
      ...doc,
      variables: {
        ...doc.variables,
        [parsed.data.name]: {
          value: parsed.data.value,
          updatedAt: new Date().toISOString(),
          updatedBy: actorLogin,
        },
      },
    };
    await writeVariables(
      octokit,
      auth.owner,
      auth.repo,
      next,
      sha,
      `chore(variables): upsert ${parsed.data.name}`,
    );
    invalidateVariablesCache(auth.owner, auth.repo);
    return NextResponse.json({ ok: true, variables: listVariables(next) });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo, name: parsed.data.name },
      "variables: upsert failed",
    );
    return NextResponse.json(
      { error: "variables_write_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
