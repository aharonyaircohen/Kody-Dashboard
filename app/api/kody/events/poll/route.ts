/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern long-polling-events
 *
 * GET /api/kody/events/poll?taskId=xxx&since=N&wait=1
 *
 * Long-polling endpoint for Kody Live. Reads `.kody/events/{taskId}.jsonl`
 * via Octokit and returns lines starting at `since`.
 *
 * Two paths:
 *  - Catch-up read (`wait=0`): always read events file from GitHub, return
 *    every line at index >= since. Useful on first connect / page reload
 *    so we don't miss events that arrived before the long-poll opened.
 *  - Long poll (`wait=1`, default): catch-up read first; if it returns
 *    nothing new, subscribe to the in-memory bus and wait up to ~25s for
 *    a fresh event from /api/kody/events/ingest. Returns immediately on
 *    push, or empty on timeout — client re-issues the fetch back-to-back.
 *
 * Auth: same x-kody-* headers OR query params as /stream.
 *
 * Response: { lines: string[], totalLines: number, exists: boolean, pushed?: boolean }
 *  - `lines`: events at indices >= `since` (each line = one ChatEvent JSON)
 *  - `totalLines`: total line count in the file (for the next watermark)
 *  - `exists`: whether the file currently exists on origin
 *  - `pushed`: true if the response was unblocked by an in-memory bus event
 *    rather than a catch-up read (useful for client telemetry)
 */

import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "buffer";
import { requireKodyAuth, getUserOctokit, getRequestAuth } from "@dashboard/lib/auth";
import { subscribe } from "@dashboard/lib/chat-event-bus";
import { logger } from "@dashboard/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 25s long-poll window — comfortably under Vercel's 60s default function
// timeout, leaves room for the response to flush before any edge limit.
export const maxDuration = 60;

// Long-poll wait window. Client re-fires immediately on response, so a
// 25s wait keeps idle GitHub API hits low (~140/hr/session) while still
// delivering pushed events with sub-second latency.
const LONG_POLL_WAIT_MS = 25_000;

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

async function readEventsFromGit(
  octokit: NonNullable<Awaited<ReturnType<typeof getUserOctokit>>>,
  owner: string,
  repo: string,
  branch: string,
  sessionId: string,
): Promise<{ allLines: string[]; exists: boolean }> {
  const path = `.kody/events/${sessionId}.jsonl`;
  try {
    const res = await octokit.rest.repos.getContent({ owner, repo, path, ref: branch });
    if (!("content" in res.data) || !res.data.content) return { allLines: [], exists: false };
    const content = Buffer.from(res.data.content, "base64").toString("utf-8");
    return { allLines: content.trim().split("\n").filter(Boolean), exists: true };
  } catch (err: unknown) {
    const e = err as { status?: number };
    if (e.status === 404) return { allLines: [], exists: false };
    throw err;
  }
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
  // wait=0 turns off long-polling — return immediately even when no new
  // events. Default is on (back-to-back long-poll mode).
  const wait = req.nextUrl.searchParams.get("wait") !== "0";

  const headerAuth = getRequestAuth(req);
  const owner = headerAuth?.owner ?? getDefaultOwner();
  const repo = headerAuth?.repo ?? getDefaultRepo();
  const branch = getDefaultBranch();

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "No GitHub token available" }, { status: 503 });
  }

  // Catch-up read first — captures anything that landed before this poll
  // opened, even if no push fires during the wait window.
  let initial: { allLines: string[]; exists: boolean };
  try {
    initial = await readEventsFromGit(octokit, owner, repo, branch, sessionId);
  } catch (err) {
    logger.error({ err, sessionId, owner, repo }, "events/poll: getContent failed");
    return NextResponse.json({ error: "fetch failed" }, { status: 500 });
  }

  const noStore = { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache" };

  if (initial.allLines.length > since || !wait) {
    return NextResponse.json(
      {
        lines: initial.allLines.slice(Math.max(0, since)),
        totalLines: initial.allLines.length,
        exists: initial.exists,
        pushed: false,
      },
      { headers: noStore },
    );
  }

  // No catch-up events. Subscribe to in-memory bus and wait. Resolves on:
  //  - any pushed event for this sessionId (almost always sub-second)
  //  - LONG_POLL_WAIT_MS timeout (return empty so client re-polls)
  //  - client abort (req.signal)
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pushed = await new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (val: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      unsubscribe?.();
      resolve(val);
    };
    unsubscribe = subscribe(sessionId, () => settle(true));
    timer = setTimeout(() => settle(false), LONG_POLL_WAIT_MS);
    req.signal.addEventListener("abort", () => settle(false));
  });

  // Re-read after wakeup. We don't trust the event payload alone because
  // the bus event might be just a notification; re-fetching from git is
  // the source of truth and only costs one extra Octokit call.
  let final: { allLines: string[]; exists: boolean };
  try {
    final = pushed ? await readEventsFromGit(octokit, owner, repo, branch, sessionId) : initial;
  } catch (err) {
    logger.warn({ err, sessionId }, "events/poll: post-push re-read failed");
    final = initial;
  }

  return NextResponse.json(
    {
      lines: final.allLines.slice(Math.max(0, since)),
      totalLines: final.allLines.length,
      exists: final.exists,
      pushed,
    },
    { headers: noStore },
  );
}
