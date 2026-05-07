/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern events-poll
 *
 * GET /api/kody/events/poll?taskId=xxx&since=N
 *
 * Returns events from `.kody/events/{taskId}.jsonl` starting at line N.
 * One-shot JSON response — the client polls back at its own cadence.
 *
 * Push (HttpSink → /ingest → in-memory bus) was attempted but doesn't
 * work reliably on Vercel because the bus is module-scoped per function
 * instance, and the engine's POST and the client's poll often land on
 * different instances. Falling back to plain client polling is simpler,
 * uses ETag caching for cheap unchanged reads, and has well-understood
 * rate-limit cost.
 *
 * Response:
 *   { lines: string[], totalLines: number, exists: boolean, fromCache: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireKodyAuth, getUserOctokit, getRequestAuth } from "@dashboard/lib/auth";
import { readEventsFile } from "@dashboard/lib/chat-events-reader";
import { logger } from "@dashboard/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getDefaultOwner(): string {
  return process.env.GITHUB_OWNER ?? "aharonyaircohen";
}
function getDefaultRepo(): string {
  return process.env.GITHUB_REPO ?? "Kody-Dashboard";
}
function getDefaultBranch(): string {
  return process.env.KODY_STORE_BRANCH ?? "main";
}

function promoteAuthFromQuery(req: NextRequest): NextRequest {
  const token = req.nextUrl.searchParams.get("token");
  const owner = req.nextUrl.searchParams.get("owner");
  const repo = req.nextUrl.searchParams.get("repo");
  if (!token && !owner && !repo) return req;
  const headers = new Headers(req.headers);
  if (token && !headers.has("x-kody-token")) headers.set("x-kody-token", token);
  if (owner && !headers.has("x-kody-owner")) headers.set("x-kody-owner", owner);
  if (repo && !headers.has("x-kody-repo")) headers.set("x-kody-repo", repo);
  return new NextRequest(req.url, { headers, method: req.method });
}

export async function GET(rawReq: NextRequest) {
  const req = promoteAuthFromQuery(rawReq);
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const sessionId = req.nextUrl.searchParams.get("taskId");
  if (!sessionId) return NextResponse.json({ error: "taskId required" }, { status: 400 });
  const since = Number(req.nextUrl.searchParams.get("since") ?? "0");

  const headerAuth = getRequestAuth(req);
  const owner = headerAuth?.owner ?? getDefaultOwner();
  const repo = headerAuth?.repo ?? getDefaultRepo();
  const branch = getDefaultBranch();

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "No GitHub token available" }, { status: 503 });
  }

  let result;
  try {
    result = await readEventsFile(octokit, owner, repo, branch, sessionId);
  } catch (err) {
    logger.error({ err, sessionId, owner, repo }, "events/poll: read failed");
    return NextResponse.json({ error: "fetch failed" }, { status: 500 });
  }

  return NextResponse.json(
    {
      lines: result.lines.slice(Math.max(0, since)),
      totalLines: result.lines.length,
      exists: result.exists,
      fromCache: result.fromCache,
    },
    {
      // No cache layer in front of a per-request session-keyed payload.
      // Within the function, etag caching is handled by chat-events-reader.
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache" },
    },
  );
}
