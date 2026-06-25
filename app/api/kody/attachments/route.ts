/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern attachments-api
 * @ai-summary Uploads a comment attachment by committing it to the configured
 *   state repo (`attachments/`) and returns markdown to embed in a comment body.
 *   Shared by every GitHub-backed composer (issues, PRs, goal discussions).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { handleKodyApiError } from "@dashboard/lib/github-error-handler";
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import {
  uploadCommentAttachment,
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";

// 10 MB raw cap. Base64 inflates ~4/3, so the encoded payload is ~13.4 MB —
// comfortably under GitHub's Contents API blob limit.
const MAX_BASE64_LEN = Math.ceil((10 * 1024 * 1024 * 4) / 3);

const postSchema = z.object({
  name: z.string().min(1).max(200),
  contentBase64: z
    .string()
    .min(1)
    .max(MAX_BASE64_LEN, "File too large (10 MB max)"),
});

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    const parsed = postSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 },
      );
    }

    // Commit under the user's identity when signed in, so the attachment
    // commit is attributed to them (matches comment authorship).
    const userOctokit = await getUserOctokit(req);
    const result = await uploadCommentAttachment(
      parsed.data,
      userOctokit ?? undefined,
    );

    return NextResponse.json(result);
  } catch (error: unknown) {
    return handleKodyApiError(error, "attachments");
  } finally {
    clearGitHubContext();
  }
}
