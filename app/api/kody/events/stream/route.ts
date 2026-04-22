/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern server-sent-events
 *
 * GET /api/kody/events/stream?taskId=xxx
 *
 * Server-Sent Events endpoint for real-time chat streaming.
 * Polls the session event file (`.kody/events/{sessionId}.jsonl`) via GitHub API.
 *
 * Events are streamed in SSE format: `data: {json}\n\n`
 *
 * Terminal events: `chat.done`, `chat.error` — endpoint closes after these.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireKodyAuth, getUserOctokit, getRequestAuth } from "@dashboard/lib/auth";
import { createUserOctokit } from "@dashboard/lib/github-client";
import { subscribe } from "@dashboard/lib/chat-event-bus";

/**
 * EventSource can't send custom headers, so the client mirrors the
 * x-kody-* header triplet into query params. We promote those params
 * to a header-shaped NextRequest so requireKodyAuth / getRequestAuth /
 * getUserOctokit work unchanged.
 */
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ChatEventEntry {
  id: string;
  runId: string;
  event: string;
  payload: {
    sessionId?: string;
    runId?: string;
    role?: "user" | "assistant";
    content?: string;
    timestamp?: string;
    error?: string;
    [key: string]: unknown;
  };
  emittedAt: string;
}

// ─── Module-level state ────────────────────────────────────────────────────────

// Track last-read line index per sessionId to avoid re-reading old events
const lastReadIndex = new Map<string, number>();

// ─── GitHub file helpers ────────────────────────────────────────────────────────

function getDefaultOwner(): string {
  return process.env.GITHUB_OWNER ?? "aharonyaircohen";
}

function getDefaultRepo(): string {
  return process.env.GITHUB_REPO ?? "Kody-Dashboard";
}

function getDefaultBranch(): string {
  return process.env.KODY_STORE_BRANCH ?? "main";
}

function sessionEventFilePath(sessionId: string): string {
  return `.kody/events/${sessionId}.jsonl`;
}

async function readEventFile(
  octokit: Awaited<ReturnType<typeof createUserOctokit>>,
  owner: string,
  repo: string,
  branch: string,
  sessionId: string,
): Promise<{ lines: string[]; exists: boolean }> {
  const path = sessionEventFilePath(sessionId);
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref: branch });
    if ("content" in data && data.content) {
      const content = Buffer.from(data.content, "base64").toString("utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      return { lines, exists: true };
    }
  } catch (err: unknown) {
    const e = err as { status?: number };
    if (e.status !== 404) throw err;
  }
  return { lines: [], exists: false };
}

// ─── Handler ───────────────────────────────────────────────────────────────────

export async function GET(rawReq: NextRequest) {
  const req = promoteAuthFromQuery(rawReq);
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const sessionId = req.nextUrl.searchParams.get("taskId");
  if (!sessionId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  // Resolve owner/repo from request headers (client localStorage auth) or env
  const headerAuth = getRequestAuth(req);
  const owner = headerAuth?.owner ?? getDefaultOwner();
  const repo = headerAuth?.repo ?? getDefaultRepo();
  const branch = getDefaultBranch();

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json({ error: "No GitHub token available" }, { status: 503 });
  }

  // ?test=1 — non-streaming mode for integration tests
  if (req.nextUrl.searchParams.get("test") === "1") {
    return NextResponse.json(
      {
        note: "test mode — not streaming",
        contentType: "text/event-stream",
        sessionId,
      },
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "X-Test-Mode": "true",
        },
      },
    );
  }

  const encoder = new TextEncoder();
  let active = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let controllerRef: ReadableStreamDefaultController<any> | null = null;
  let unsubscribe: (() => void) | null = null;
  const seenEventIds = new Set<string>();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
    cancel() {
      active = false;
      unsubscribe?.();
      lastReadIndex.delete(sessionId);
    },
  });

  // Push channel: in-memory subscription fed by /api/kody/events/ingest.
  // Falls back transparently to the GitHub poll below when the engine runs
  // on a different Vercel instance or without the dashboardUrl token.
  unsubscribe = subscribe(sessionId, (raw) => {
    const ctrl = controllerRef;
    if (!active || !ctrl) return;
    const event = raw as ChatEventEntry;
    const eventKey = `${event.runId ?? ""}:${event.emittedAt ?? ""}:${event.event}`;
    if (seenEventIds.has(eventKey)) return;
    seenEventIds.add(eventKey);

    if (event.event === "chat.done" || event.event === "chat.error") {
      const data = event.event === "chat.done"
        ? JSON.stringify({ type: "chat.done", sessionId, runId: event.runId })
        : JSON.stringify({ type: "chat.error", sessionId, error: event.payload?.error });
      try { ctrl.enqueue(encoder.encode(`data: ${data}\n\n`)); } catch { /* closed */ }
      active = false;
      try { ctrl.close(); } catch { /* already closed */ }
      return;
    }

    if (event.event === "chat.message") {
      const data = JSON.stringify({
        type: "chat.message",
        sessionId: event.payload?.sessionId ?? sessionId,
        runId: event.runId,
        role: event.payload?.role,
        content: event.payload?.content,
        timestamp: event.payload?.timestamp,
      });
      try { ctrl.enqueue(encoder.encode(`data: ${data}\n\n`)); } catch { /* closed */ }
    }
  });

  const poll = setInterval(async () => {
    // Capture narrowed type via local const — TypeScript doesn't track narrowing
    // across async setInterval callbacks without this
    const ctrl: ReadableStreamDefaultController | null = controllerRef;
    if (!active || !ctrl) return;

    const { lines } = await readEventFile(octokit, owner, repo, branch, sessionId);

    const startIndex = lastReadIndex.get(sessionId) ?? 0;
    const newLines = lines.slice(startIndex);

    if (newLines.length > 0) {
      lastReadIndex.set(sessionId, lines.length);
    }

    for (const line of newLines) {
      if (!active) break;
      let event: ChatEventEntry | null = null;
      try { event = JSON.parse(line) as ChatEventEntry; }
      catch { continue; }

      const eventKey = `${event.runId ?? ""}:${event.emittedAt ?? ""}:${event.event}`;
      if (seenEventIds.has(eventKey)) continue;
      seenEventIds.add(eventKey);

      if (event.event === "chat.done" || event.event === "chat.error") {
        const data = event.event === "chat.done"
          ? JSON.stringify({ type: "chat.done", sessionId, runId: event.runId })
          : JSON.stringify({ type: "chat.error", sessionId, error: event.payload.error });
        try { ctrl.enqueue(encoder.encode(`data: ${data}\n\n`)); } catch { /* closed */ }
        active = false;
        clearInterval(poll);
        try { ctrl.close(); } catch { /* already closed */ }
        return;
      }

      if (event.event === "chat.message") {
        const data = JSON.stringify({
          type: "chat.message",
          sessionId: event.payload.sessionId,
          runId: event.runId,
          role: event.payload.role,
          content: event.payload.content,
          timestamp: event.payload.timestamp,
        });
        try { ctrl.enqueue(encoder.encode(`data: ${data}\n\n`)); } catch { /* closed */ }
      }
    }
  }, 1000);

  // Send initial connected heartbeat
  if (controllerRef) {
    try {
      (controllerRef as ReadableStreamDefaultController<Uint8Array>).enqueue(encoder.encode(
        `data: ${JSON.stringify({ type: "connected", sessionId })}\n\n`,
      ));
    } catch { /* closed */ }
  }

  // Clean up on client disconnect
  req.signal.addEventListener("abort", () => {
    active = false;
    clearInterval(poll);
    unsubscribe?.();
    lastReadIndex.delete(sessionId);
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
