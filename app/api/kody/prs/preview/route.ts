/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern prs-preview-api
 * @ai-summary Resolves a PR's preview URL for the preview pane — Fly first,
 * Vercel as fallback. Previews are built on Fly now, so when the repo has a
 * Fly token and a per-PR app exists we return its `<app>.fly.dev` URL. When
 * Fly isn't configured (no token) or hasn't built one yet, we fall back to
 * the PR's Vercel deployment by head commit (the original behaviour), so
 * repos still on Vercel keep working. `pr` is optional purely so the Vercel
 * fallback still answers when the caller only has a sha.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { handleKodyApiError } from "@dashboard/lib/github-error-handler";
import {
  requireKodyAuth,
  getRequestAuth,
  getUserOctokit,
} from "@dashboard/lib/auth";
import {
  fetchPreviewForSha,
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import { flyPrPreviewUrl } from "@dashboard/lib/previews/fly-pr-preview-url";
import { mintPreviewTicket } from "@dashboard/lib/preview-token";

// Git SHAs are 40 hex chars; accept 7-40 to tolerate abbreviated refs.
const querySchema = z.object({
  sha: z.string().regex(/^[0-9a-f]{7,40}$/, "sha must be a hex commit SHA"),
  pr: z.coerce.number().int().positive().optional(),
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
      sha: searchParams.get("sha"),
      pr: searchParams.get("pr") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid sha" }, { status: 400 });
    }

    // Prefer the Fly preview when this repo builds previews on Fly and the
    // per-PR app exists. flyPrPreviewUrl returns null for every "not on Fly"
    // case, so we transparently fall back to the Vercel lookup below.
    if (parsed.data.pr && headerAuth) {
      const octokit = await getUserOctokit(req);
      if (octokit) {
        const flyUrl = await flyPrPreviewUrl(
          octokit,
          headerAuth.owner,
          headerAuth.repo,
          parsed.data.pr,
        );
        if (flyUrl) {
          // Append a signed access ticket — the doorman in the preview machine
          // verifies it and exchanges it for a session cookie on first load.
          const { ticket } = mintPreviewTicket(
            `${headerAuth.owner}/${headerAuth.repo}`,
            parsed.data.pr,
            4 * 60 * 60, // 4 hours TTL
          );
          const previewUrl = `${flyUrl}?kp=${ticket}`;
          return NextResponse.json({ previewUrl, source: "fly" });
        }
      }
    }

    const previewUrl = await fetchPreviewForSha(parsed.data.sha);
    return NextResponse.json({ previewUrl, source: "vercel" });
  } catch (error: unknown) {
    return handleKodyApiError(error, "pr-preview");
  } finally {
    clearGitHubContext();
  }
}
