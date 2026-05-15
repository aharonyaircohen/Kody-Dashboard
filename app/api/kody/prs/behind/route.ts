/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern prs-behind-api
 * @ai-summary Returns how many commits a PR head branch is behind its base.
 * Used to gate the Preview "Sync" button — when 0, branch is up to date.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { handleKodyApiError } from "@dashboard/lib/github-error-handler";
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth";
import {
  fetchOpenPRs,
  fetchPRBehind,
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";

const querySchema = z.object({
  prNumber: z.coerce.number().int().positive(),
});

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse({
      prNumber: searchParams.get("prNumber"),
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid prNumber" }, { status: 400 });
    }

    const openPRs = await fetchOpenPRs();
    const pr = openPRs.find((p) => p.number === parsed.data.prNumber);
    if (!pr || !pr.base?.ref) {
      // PR not in open list (closed/merged) or no base — nothing to sync.
      return NextResponse.json({ behindBy: 0 });
    }

    const behindBy = await fetchPRBehind(pr.base.ref, pr.head.ref);
    return NextResponse.json({ behindBy });
  } catch (error: unknown) {
    return handleKodyApiError(error, "pr-behind");
  } finally {
    clearGitHubContext();
  }
}
