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
import { logger } from "@dashboard/lib/logger";

// ─── Rate-limit tuning ─────────────────────────────────────────────────────────
// 15s base poll (was 3s) — pushes are the real freshness path; this is fallback.
const POLL_INTERVAL_MS = 15_000;
// 120s grace after any push (was 5s) — while engine is delivering inline events,
// the GitHub poll stays dormant.
const PUSH_GRACE_MS = 120_000;
// Reconnect dedup: a flapping client cannot force a fresh poll faster than this.
const MIN_POLL_GAP_MS = 10_000;

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
// A chat reply commonly takes 60–120 s (runner boot + LLM). The default
// Vercel function timeout (10 s hobby / 60 s pro) cuts the SSE stream
// before the engine commits its reply, so the UI never receives it.
// Bump to the max the Pro plan allows — on a hobby plan this still
// applies but is silently clamped.
export const maxDuration = 300;
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

// ETag cache so unchanged GitHub reads return 304 (does not count against rate limit)
const etagCache = new Map<string, { etag: string; lines: string[] }>();

// Last GitHub poll timestamp per sessionId — survives SSE reconnects so a
// flapping client can't reset the polling cadence to zero.
const lastPolledAt = new Map<string, number>();

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
  const cached = etagCache.get(sessionId);
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
      headers: cached?.etag ? { "If-None-Match": cached.etag } : undefined,
    });
    const { data, headers } = response;
    const h = headers as Record<string, string> | undefined;
    const newEtag = h?.etag;
    const remaining = h?.["x-ratelimit-remaining"];
    if (remaining !== undefined && Number(remaining) < 500) {
      logger.warn(
        { remaining, sessionId, resource: h?.["x-ratelimit-resource"] },
        "github rate-limit low",
      );
    }
    if ("content" in data && data.content) {
      const content = Buffer.from(data.content, "base64").toString("utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      if (newEtag) etagCache.set(sessionId, { etag: newEtag, lines });
      return { lines, exists: true };
    }
  } catch (err: unknown) {
    const e = err as { status?: number };
    // 304 Not Modified — file is unchanged, reuse cached lines (this response
    // does NOT count against the GitHub rate limit).
    if (e.status === 304 && cached) return { lines: cached.lines, exists: true };
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

  // `mode=interactive` keeps the stream alive across multiple chat.done
  // events (one per turn). The runner stays alive until idle/deadline and
  // emits chat.exit when it ends — that's the close signal for interactive.
  // Default (one-shot) closes on the first chat.done as before.
  const interactiveMode = req.nextUrl.searchParams.get("mode") === "interactive";

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
  // Timestamp of last in-memory push delivery. While this is recent, the poll
  // is suppressed entirely — no GitHub call at all.
  let lastPushAt = 0;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
    cancel() {
      active = false;
      unsubscribe?.();
      // Note: we intentionally do NOT clear lastPolledAt here — it must
      // survive reconnects to prevent flapping clients from resetting cadence.
      // lastReadIndex / etagCache are kept for the same reason: a quick
      // reconnect should resume from where we left off, not refetch.
    },
  });

  // Push channel: in-memory subscription fed by /api/kody/events/ingest.
  // Falls back transparently to the GitHub poll below when the engine runs
  // on a different Vercel instance or without the dashboardUrl token.
  unsubscribe = subscribe(sessionId, (raw) => {
    const ctrl = controllerRef;
    if (!active || !ctrl) return;
    lastPushAt = Date.now();
    const event = raw as ChatEventEntry;
    const eventKey = `${event.runId ?? ""}:${event.emittedAt ?? ""}:${event.event}`;
    if (seenEventIds.has(eventKey)) return;
    seenEventIds.add(eventKey);

    // Lifecycle events (interactive mode only — one-shot never emits these).
    if (event.event === "chat.ready") {
      const data = JSON.stringify({
        type: "chat.ready",
        sessionId,
        runId: event.runId,
        idleExitMs: event.payload?.idleExitMs,
        hardCapMs: event.payload?.hardCapMs,
        startedAt: event.payload?.startedAt,
      });
      try { ctrl.enqueue(encoder.encode(`data: ${data}\n\n`)); } catch { /* closed */ }
      return;
    }
    if (event.event === "chat.exit") {
      const data = JSON.stringify({
        type: "chat.exit",
        sessionId,
        runId: event.runId,
        reason: event.payload?.reason,
        turnsCompleted: event.payload?.turnsCompleted,
      });
      try { ctrl.enqueue(encoder.encode(`data: ${data}\n\n`)); } catch { /* closed */ }
      // chat.exit is the canonical close signal for interactive sessions.
      active = false;
      try { ctrl.close(); } catch { /* already closed */ }
      return;
    }

    if (event.event === "chat.done" || event.event === "chat.error") {
      const data = event.event === "chat.done"
        ? JSON.stringify({ type: "chat.done", sessionId, runId: event.runId })
        : JSON.stringify({ type: "chat.error", sessionId, error: event.payload?.error });
      try { ctrl.enqueue(encoder.encode(`data: ${data}\n\n`)); } catch { /* closed */ }
      // In one-shot mode, chat.done = end of session. In interactive mode,
      // chat.done = end of turn — keep the stream open for the next user
      // message; the runner stays alive until chat.exit.
      if (!interactiveMode) {
        active = false;
        try { ctrl.close(); } catch { /* already closed */ }
      }
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
    if (!active || !ctrl) {
      logger.info({ sessionId, active, hasCtrl: !!ctrl }, "stream:poll: skipping — inactive");
      return;
    }

    // Skip GitHub entirely while the in-memory push channel is live. The poll
    // is a fallback for cross-instance SSE; when push is delivering, it's pure
    // waste. 120s grace covers an entire engine reply burst.
    if (Date.now() - lastPushAt < PUSH_GRACE_MS) {
      logger.info({ sessionId, lastPushAt }, "stream:poll: skipping — push grace");
      return;
    }

    // Reconnect-storm guard: if another SSE connection for this sessionId
    // polled GitHub recently, skip. Survives client reconnects via module map.
    const last = lastPolledAt.get(sessionId) ?? 0;
    if (Date.now() - last < MIN_POLL_GAP_MS) {
      logger.info({ sessionId, gapMs: Date.now() - last }, "stream:poll: skipping — gap guard");
      return;
    }
    lastPolledAt.set(sessionId, Date.now());

    let lines: string[];
    try {
      const result = await readEventFile(octokit, owner, repo, branch, sessionId);
      lines = result.lines;
      logger.info({ sessionId, owner, repo, lineCount: lines.length, exists: result.exists }, "stream:poll: read events file");
    } catch (err) {
      logger.error({ err, sessionId, owner, repo }, "stream:poll: readEventFile threw");
      return;
    }

    const startIndex = lastReadIndex.get(sessionId) ?? 0;
    const newLines = lines.slice(startIndex);
    logger.info({ sessionId, startIndex, totalLines: lines.length, newLines: newLines.length }, "stream:poll: dispatching");

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

      // Lifecycle events (interactive mode only).
      if (event.event === "chat.ready") {
        const data = JSON.stringify({
          type: "chat.ready",
          sessionId,
          runId: event.runId,
          idleExitMs: (event.payload as Record<string, unknown>).idleExitMs,
          hardCapMs: (event.payload as Record<string, unknown>).hardCapMs,
          startedAt: (event.payload as Record<string, unknown>).startedAt,
        });
        try { ctrl.enqueue(encoder.encode(`data: ${data}\n\n`)); } catch { /* closed */ }
        continue;
      }
      if (event.event === "chat.exit") {
        const data = JSON.stringify({
          type: "chat.exit",
          sessionId,
          runId: event.runId,
          reason: (event.payload as Record<string, unknown>).reason,
          turnsCompleted: (event.payload as Record<string, unknown>).turnsCompleted,
        });
        try { ctrl.enqueue(encoder.encode(`data: ${data}\n\n`)); } catch { /* closed */ }
        active = false;
        clearInterval(poll);
        try { ctrl.close(); } catch { /* already closed */ }
        return;
      }

      if (event.event === "chat.done" || event.event === "chat.error") {
        const data = event.event === "chat.done"
          ? JSON.stringify({ type: "chat.done", sessionId, runId: event.runId })
          : JSON.stringify({ type: "chat.error", sessionId, error: event.payload.error });
        try { ctrl.enqueue(encoder.encode(`data: ${data}\n\n`)); } catch { /* closed */ }
        // See push-channel branch above for the mode rationale.
        if (!interactiveMode) {
          active = false;
          clearInterval(poll);
          try { ctrl.close(); } catch { /* already closed */ }
          return;
        }
        continue;
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
  }, POLL_INTERVAL_MS);

  // Send initial connected heartbeat
  if (controllerRef) {
    try {
      (controllerRef as ReadableStreamDefaultController<Uint8Array>).enqueue(encoder.encode(
        `data: ${JSON.stringify({ type: "connected", sessionId })}\n\n`,
      ));
    } catch { /* closed */ }
  }

  // Clean up on client disconnect. Keep lastReadIndex / etagCache /
  // lastPolledAt across reconnects so a flapping client cannot reset state.
  req.signal.addEventListener("abort", () => {
    active = false;
    clearInterval(poll);
    unsubscribe?.();
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
