/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern prs-api
 * @ai-summary API route to fetch PRs
 */
import { NextRequest, NextResponse } from "next/server";

import { handleKodyApiError } from "@dashboard/lib/github-error-handler";
import { prsQuerySchema } from "@dashboard/lib/schemas";
import { parseQueryParams } from "@dashboard/lib/api-responses";
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth";
import {
  findAssociatedPR,
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";

export async function GET(req: NextRequest) {
  // Check auth
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  // Validate query params
  const parsed = parseQueryParams(req, prsQuerySchema);
  if ("error" in parsed) return parsed.error;
  const { taskId } = parsed.data;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const pr = await findAssociatedPR(taskId);

    return NextResponse.json({ pr });
  } catch (error: unknown) {
    return handleKodyApiError(error, "prs");
  } finally {
    clearGitHubContext();
  }
}
