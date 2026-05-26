/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern prs-preview-api
 * @ai-summary Resolves a PR's Vercel preview URL directly by its head commit.
 * On-demand path for the preview pane — finds the link even when the PR has
 * aged out of the recent-100 deployment window the tasks list scans.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { handleKodyApiError } from "@dashboard/lib/github-error-handler";
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth";
import {
  fetchPreviewForSha,
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";

// Git SHAs are 40 hex chars; accept 7-40 to tolerate abbreviated refs.
const querySchema = z.object({
  sha: z.string().regex(/^[0-9a-f]{7,40}$/, "sha must be a hex commit SHA"),
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
    const parsed = querySchema.safeParse({ sha: searchParams.get("sha") });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid sha" }, { status: 400 });
    }

    const previewUrl = await fetchPreviewForSha(parsed.data.sha);
    return NextResponse.json({ previewUrl });
  } catch (error: unknown) {
    return handleKodyApiError(error, "pr-preview");
  } finally {
    clearGitHubContext();
  }
}
