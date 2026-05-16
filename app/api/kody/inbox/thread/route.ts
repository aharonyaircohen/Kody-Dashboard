/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern inbox-thread-api
 * @ai-summary Resolves a single inbox entry's GitHub thread (Issue or PR)
 *   into renderable content so the dashboard can show it inline instead of
 *   bouncing the user to github.com. Reuses the already-cached
 *   `fetchIssue` + `fetchPRComments` helpers — this endpoint is hit
 *   on-demand (one click), never polled, so it adds no rate-limit pressure.
 *   Discussions/Commits/Releases are intentionally unsupported; the client
 *   falls back to opening github.com for those.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { handleKodyApiError } from "@dashboard/lib/github-error-handler";
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth";
import {
  fetchIssue,
  fetchPRComments,
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";

const getSchema = z.object({
  type: z.enum(["Issue", "PullRequest"]),
  number: z.coerce.number().int().positive(),
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
    const parsed = getSchema.safeParse({
      type: searchParams.get("type"),
      number: searchParams.get("number"),
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid type/number", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { number } = parsed.data;

    // PRs are issues under the hood — issues.get / issues.listComments
    // resolve the body + conversation thread for both.
    const [issue, comments] = await Promise.all([
      fetchIssue(number),
      fetchPRComments(number),
    ]);

    if (!issue) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    return NextResponse.json({
      thread: {
        title: issue.title,
        body: issue.body ?? "",
        state: issue.state,
        htmlUrl: issue.html_url,
        createdAt: issue.created_at,
        comments: comments.map((c) => ({
          id: c.id,
          body: c.body,
          created_at: c.created_at,
          user: {
            login: c.user.login,
            type: "User" as const,
            avatar_url: c.user.avatar_url,
          },
        })),
      },
    });
  } catch (error: unknown) {
    return handleKodyApiError(error, "inbox-thread");
  } finally {
    clearGitHubContext();
  }
}
