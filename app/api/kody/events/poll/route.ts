/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern long-polling-events
 *
 * GET /api/kody/events/poll?taskId=xxx&since=N
 *
 * Returns events from `.kody/events/{taskId}.jsonl` starting at line N.
 * One-shot JSON response — no streaming, no SSE. Built specifically because
 * Vercel's Node.js runtime buffers long-lived SSE responses such that
 * chat.ready never reaches the browser while the stream is open. Plain
 * fetch + setInterval on the client sidesteps the buffering entirely.
 *
 * Auth: same x-kody-* headers OR query params as /stream.
 *
 * Response: { lines: string[], totalLines: number, exists: boolean }
 *  - `lines`: events at indices >= `since` (each line = one ChatEvent JSON)
 *  - `totalLines`: total line count in the file (for the next watermark)
 *  - `exists`: whether the file currently exists on origin
 */

import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "buffer";
import { requireKodyAuth, getUserOctokit, getRequestAuth } from "@dashboard/lib/auth";
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
  if (!sessionId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }
  const since = Number(req.nextUrl.searchParams.get("since") ?? "0");

  const headerAuth = getRequestAuth(req);
  const owner = headerAuth?.owner ?? getDefaultOwner();
  const repo = headerAuth?.repo ?? getDefaultRepo();
  const branch = getDefaultBranch();

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "No GitHub token available" }, { status: 503 });
  }

  const path = `.kody/events/${sessionId}.jsonl`;
  try {
    const res = await octokit.rest.repos.getContent({ owner, repo, path, ref: branch });
    if (!("content" in res.data) || !res.data.content) {
      return NextResponse.json({ lines: [], totalLines: 0, exists: false });
    }
    const content = Buffer.from(res.data.content, "base64").toString("utf-8");
    const allLines = content.trim().split("\n").filter(Boolean);
    const lines = allLines.slice(Math.max(0, since));
    return NextResponse.json(
      { lines, totalLines: allLines.length, exists: true },
      // Discourage any caching layer (CDN, browser) — every poll must hit
      // GitHub through this function. The branch protection means lines
      // only ever grow, so stale responses would silently miss events.
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache" } },
    );
  } catch (err: unknown) {
    const e = err as { status?: number };
    if (e.status === 404) {
      return NextResponse.json({ lines: [], totalLines: 0, exists: false });
    }
    logger.error({ err, sessionId, owner, repo }, "events/poll: getContent failed");
    return NextResponse.json({ error: "fetch failed" }, { status: 500 });
  }
}
