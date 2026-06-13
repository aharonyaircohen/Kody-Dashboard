/**
 * @fileType api-endpoint
 * @domain variables
 * @pattern variables-api
 * @ai-summary DELETE /api/kody/variables/[name] — remove a variable.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import {
  listVariables,
  readVariables,
  updateVariables,
} from "@dashboard/lib/variables/store";
import { logger } from "@dashboard/lib/logger";

interface RouteContext {
  params: Promise<{ name: string }>;
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const { name } = await context.params;
  if (!name) {
    return NextResponse.json({ error: "missing_name" }, { status: 400 });
  }

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const octokit = await getUserOctokit(req);
  if (!octokit)
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });

  try {
    const existing = await readVariables(octokit, auth.owner, auth.repo, {
      force: true,
    });
    if (!(name in existing.doc.variables)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const { doc: next } = await updateVariables(
      octokit,
      auth.owner,
      auth.repo,
      (doc) => {
        const nextVars = { ...doc.variables };
        delete nextVars[name];
        return { ...doc, variables: nextVars };
      },
      `chore(variables): delete ${name}`,
    );
    return NextResponse.json({ ok: true, variables: listVariables(next) });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo, name },
      "variables: delete failed",
    );
    return NextResponse.json(
      { error: "variables_write_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
