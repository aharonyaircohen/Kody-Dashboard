/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern inbox-feed-pull
 * @ai-summary GET /api/kody/inbox/feed?since=<iso>
 *
 *   Returns the slice of the per-repo inbox **feed** that targets the
 *   logged-in user (entries whose `login` matches the caller's GitHub
 *   login), newer than the `since` cursor. The client watcher polls this
 *   and appends the entries into the user's private inbox gist.
 *
 *   The feed itself is written server-side by the webhook receiver
 *   (`push/mention-dispatch.ts` → `inbox/feed-server.ts`) using the bot
 *   token, so a mention lands here the instant the webhook fires —
 *   independent of whether the user watches the repo or has a tab open.
 *
 *   Auth: same `requireKodyAuth` + `getRequestAuth` plumbing as the rest
 *   of the inbox routes. The feed manifest is read on the cached GitHub
 *   path (TTL ≥ 60s + ETag), so polling here doesn't burn the shared
 *   rate budget — see CLAUDE.md > "GitHub API rate-limit rules".
 */
import { NextRequest, NextResponse } from "next/server";
import {
  requireKodyAuth,
  getRequestAuth,
  getUserOctokit,
} from "@dashboard/lib/auth";
import {
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import { readInboxFeed } from "@dashboard/lib/inbox/feed-server";

export async function GET(req: NextRequest) {
  const authErr = await requireKodyAuth(req);
  if (authErr) return authErr;
  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json(
      { error: "auth_required", message: "Missing repo auth headers" },
      { status: 401 },
    );
  }
  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json(
      { error: "auth_required", message: "No octokit instance" },
      { status: 401 },
    );
  }

  let login: string | null = null;
  try {
    const { data } = await octokit.rest.users.getAuthenticated();
    login = typeof data?.login === "string" ? data.login : null;
  } catch {
    login = null;
  }
  if (!login) {
    return NextResponse.json(
      { error: "auth_required", message: "Could not resolve GitHub login" },
      { status: 401 },
    );
  }

  const sinceRaw = req.nextUrl.searchParams.get("since");
  const sinceMs = sinceRaw ? Date.parse(sinceRaw) : NaN;
  const me = login.toLowerCase();

  setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  try {
    const manifest = await readInboxFeed();
    const entries = manifest.entries.filter((e) => {
      if (e.login !== me) return false;
      if (!Number.isNaN(sinceMs)) {
        const t = Date.parse(e.sentAt);
        if (!Number.isNaN(t) && t <= sinceMs) return false;
      }
      return true;
    });
    return NextResponse.json(
      { login: me, entries },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "read_failed",
        message: err instanceof Error ? err.message : "read failed",
      },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
