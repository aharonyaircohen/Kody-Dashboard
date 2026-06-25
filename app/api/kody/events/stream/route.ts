/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern server-sent-events
 *
 * GET /api/kody/events/stream?taskId=xxx
 *
 * Server-Sent Events endpoint for real-time chat streaming.
 * Polls the session event file (`events/{sessionId}.jsonl`) via GitHub API.
 *
 * Events are streamed in SSE format: `data: {json}\n\n`
 *
 * Terminal events: `chat.done`, `chat.error` — endpoint closes after these.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import { createUserOctokit } from "@dashboard/lib/github-client";
import { subscribe } from "@dashboard/lib/chat-event-bus";
import { logger } from "@dashboard/lib/logger";
import { readStateText } from "@dashboard/lib/state-repo";

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

// Track last-read line index per sessionId. Reset at the start of each
// connection so a fresh SSE always replays from line 0 (see line ~210).
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
  return `events/${sessionId}.jsonl`;
}

async function readEventFile(
  octokit: Awaited<ReturnType<typeof createUserOctokit>>,
  owner: string,
  repo: string,
  _branch: string,
  sessionId: string,
): Promise<{ lines: string[]; exists: boolean }> {
  const path = sessionEventFilePath(sessionId);
  const cached = etagCache.get(sessionId);
  try {
    const file = await readStateText(octokit, owner, repo, path, {
      headers: cached?.etag ? { "If-None-Match": cached.etag } : undefined,
    });
    if (file) {
      const lines = file.content.trim().split("\n").filter(Boolean);
      if (file.etag) etagCache.set(sessionId, { etag: file.etag, lines });
      return { lines, exists: true };
    }
  } catch (err: unknown) {
    const e = err as { status?: number };
    // 304 Not Modified — file is unchanged, reuse cached lines (this response
    // does NOT count against the GitHub rate limit).
    if (e.status === 304 && cached)
      return { lines: cached.lines, exists: true };
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
  const interactiveMode =
    req.nextUrl.searchParams.get("mode") === "interactive";

  // Resolve owner/repo from request headers (client localStorage auth) or env
  const headerAuth = getRequestAuth(req);
  const owner = headerAuth?.owner ?? getDefaultOwner();
  const repo = headerAuth?.repo ?? getDefaultRepo();
  const branch = getDefaultBranch();

  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json(
      { error: "No GitHub token available" },
      { status: 503 },
    );
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

  // Reset the per-session read watermark + etag cache so this connection
  // sees the full events file from the start. Without this, a previous
  // connection (other tab, devtools probe, …) that already consumed all
  // existing lines would have left lastReadIndex == lines.length, and
  // this connection would see an empty newLines slice forever — visible
  // bug: dashboard banner stuck at "Almost ready" while chat.ready is
  // already on git. lastPolledAt is intentionally kept (rate-limit guard).
  lastReadIndex.delete(sessionId);
  etagCache.delete(sessionId);

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
        runUrl: (event.payload as Record<string, unknown> | undefined)?.runUrl,
      });
      try {
        ctrl.enqueue(encoder.encode(`data: ${data}\n\n`));
      } catch {
        /* closed */
      }
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
      try {
        ctrl.enqueue(encoder.encode(`data: ${data}\n\n`));
      } catch {
        /* closed */
      }
      // chat.exit is the canonical close signal for interactive sessions.
      active = false;
      try {
        ctrl.close();
      } catch {
        /* already closed */
      }
      return;
    }

    if (event.event === "chat.done" || event.event === "chat.error") {
      const data =
        event.event === "chat.done"
          ? JSON.stringify({ type: "chat.done", sessionId, runId: event.runId })
          : JSON.stringify({
              type: "chat.error",
              sessionId,
              error: event.payload?.error,
            });
      try {
        ctrl.enqueue(encoder.encode(`data: ${data}\n\n`));
      } catch {
        /* closed */
      }
      // In one-shot mode, chat.done = end of session. In interactive mode,
      // chat.done = end of turn — keep the stream open for the next user
      // message; the runner stays alive until chat.exit.
      if (!interactiveMode) {
        active = false;
        try {
          ctrl.close();
        } catch {
          /* already closed */
        }
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
      try {
        ctrl.enqueue(encoder.encode(`data: ${data}\n\n`));
      } catch {
        /* closed */
      }
      return;
    }

    // Live progress: thinking + tool calls. Engine ≥ 0.4.69 emits these
    // as the agent works so the dashboard can render mid-turn activity
    // instead of staring at a blank chat for 60-120s. Re-shaped to match
    // the kody-direct SSE schema the chat client already understands
    // (chat.thinking → thinking panel; chat.tool_use / chat.tool_result
    // → tool-call cards attached to the in-flight assistant message).
    if (event.event === "chat.thinking") {
      const data = JSON.stringify({
        type: "chat.thinking",
        sessionId,
        runId: event.runId,
        text: event.payload?.text,
        timestamp: event.emittedAt,
      });
      try {
        ctrl.enqueue(encoder.encode(`data: ${data}\n\n`));
      } catch {
        /* closed */
      }
      return;
    }
    if (event.event === "chat.tool") {
      const phase = event.payload?.phase;
      const data =
        phase === "result"
          ? JSON.stringify({
              type: "chat.tool_result",
              sessionId,
              runId: event.runId,
              toolUseId: event.payload?.toolUseId,
              content: event.payload?.content,
              isError: event.payload?.isError === true,
              timestamp: event.emittedAt,
            })
          : JSON.stringify({
              type: "chat.tool_use",
              sessionId,
              runId: event.runId,
              id: event.payload?.id,
              name: event.payload?.name,
              input: event.payload?.input,
              timestamp: event.emittedAt,
            });
      try {
        ctrl.enqueue(encoder.encode(`data: ${data}\n\n`));
      } catch {
        /* closed */
      }
      return;
    }
  });

  let pollIteration = 0;
  // The setInterval poll body, but as a named function so we can also fire
  // it once IMMEDIATELY when the SSE opens. Without this, the first poll
  // is 15s after connect, which means a session whose chat.ready already
  // landed on git stays invisible for that whole window — and on slow
  // Vercel function instances setInterval can be even more delayed.
  const runPollOnce = async () => {
    pollIteration += 1;
    const ctrl: ReadableStreamDefaultController | null = controllerRef;
    logger.info(
      { sessionId, pollIteration, active, hasCtrl: !!ctrl },
      "stream:poll: tick",
    );
    if (!active || !ctrl) {
      logger.info(
        { sessionId, pollIteration },
        "stream:poll: skipping — inactive",
      );
      return;
    }

    // Skip GitHub entirely while the in-memory push channel is live. The poll
    // is a fallback for cross-instance SSE; when push is delivering, it's pure
    // waste. 120s grace covers an entire engine reply burst.
    if (Date.now() - lastPushAt < PUSH_GRACE_MS) {
      logger.info(
        { sessionId, lastPushAt },
        "stream:poll: skipping — push grace",
      );
      return;
    }

    // Reconnect-storm guard: if another SSE connection for this sessionId
    // polled GitHub recently, skip. Survives client reconnects via module map.
    const last = lastPolledAt.get(sessionId) ?? 0;
    if (Date.now() - last < MIN_POLL_GAP_MS) {
      logger.info(
        { sessionId, gapMs: Date.now() - last },
        "stream:poll: skipping — gap guard",
      );
      return;
    }
    lastPolledAt.set(sessionId, Date.now());

    let lines: string[];
    try {
      const result = await readEventFile(
        octokit,
        owner,
        repo,
        branch,
        sessionId,
      );
      lines = result.lines;
      logger.info(
        {
          sessionId,
          owner,
          repo,
          lineCount: lines.length,
          exists: result.exists,
        },
        "stream:poll: read events file",
      );
    } catch (err) {
      logger.error(
        { err, sessionId, owner, repo },
        "stream:poll: readEventFile threw",
      );
      return;
    }

    const startIndex = lastReadIndex.get(sessionId) ?? 0;
    const newLines = lines.slice(startIndex);
    logger.info(
      {
        sessionId,
        pollIteration,
        startIndex,
        totalLines: lines.length,
        newLines: newLines.length,
        firstLine: newLines[0]?.slice(0, 200),
      },
      "stream:poll: dispatching",
    );

    if (newLines.length > 0) {
      lastReadIndex.set(sessionId, lines.length);
    }

    for (const line of newLines) {
      if (!active) break;
      let event: ChatEventEntry | null = null;
      try {
        event = JSON.parse(line) as ChatEventEntry;
      } catch {
        continue;
      }

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
          runUrl: (event.payload as Record<string, unknown>).runUrl,
        });
        try {
          ctrl.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          /* closed */
        }
        continue;
      }
      if (event.event === "chat.exit") {
        const data = JSON.stringify({
          type: "chat.exit",
          sessionId,
          runId: event.runId,
          reason: (event.payload as Record<string, unknown>).reason,
          turnsCompleted: (event.payload as Record<string, unknown>)
            .turnsCompleted,
        });
        try {
          ctrl.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          /* closed */
        }
        active = false;
        try {
          ctrl.close();
        } catch {
          /* already closed */
        }
        return;
      }

      if (event.event === "chat.done" || event.event === "chat.error") {
        const data =
          event.event === "chat.done"
            ? JSON.stringify({
                type: "chat.done",
                sessionId,
                runId: event.runId,
              })
            : JSON.stringify({
                type: "chat.error",
                sessionId,
                error: event.payload.error,
              });
        try {
          ctrl.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          /* closed */
        }
        // See push-channel branch above for the mode rationale.
        if (!interactiveMode) {
          active = false;
          try {
            ctrl.close();
          } catch {
            /* already closed */
          }
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
        try {
          ctrl.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          /* closed */
        }
      }
    }
  };

  // Send initial connected heartbeat + 4KB padding comment. Vercel's edge
  // proxy buffers SSE responses by default; small heartbeats (`: ping\n\n`,
  // 9 bytes) don't overflow the buffer fast enough, so events sit in the
  // buffer until the connection closes — visible bug: long-lived browser
  // EventSource never sees chat.ready while a fresh curl probe gets it
  // instantly (the curl closes the connection, flushing the buffer).
  // 4KB of comment padding is the standard SSE workaround — exceeds nginx
  // and most CDN buffer thresholds, forcing per-event flush.
  const padding = `:${" ".repeat(4096)}\n\n`;
  if (controllerRef) {
    try {
      const ctrlInit =
        controllerRef as ReadableStreamDefaultController<Uint8Array>;
      ctrlInit.enqueue(encoder.encode(padding));
      ctrlInit.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "connected", sessionId })}\n\n`,
        ),
      );
    } catch {
      /* closed */
    }
  }

  // ─── Async loop: keeps the function ACTIVELY awaiting in the stream
  // context. Vercel's Node.js runtime does NOT keep setInterval timers
  // alive once the response handler returns — it freezes the function
  // until the next request. Using an awaited setTimeout chain ties the
  // polling to a pending promise inside the stream, which Vercel keeps
  // alive (visible bug before this fix: only the first tick logged, the
  // browser EventSource sat there for 3 minutes without ever seeing
  // chat.ready even though a fresh curl probe got it instantly).
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  void (async () => {
    // First poll runs immediately so chat.ready that's already on git
    // delivers without a 15s wait.
    await runPollOnce();
    while (active) {
      await sleep(POLL_INTERVAL_MS);
      if (!active) break;
      await runPollOnce();
    }
  })();
  void (async () => {
    // Heartbeat keeps the TCP idle from killing the long-lived SSE.
    while (active) {
      await sleep(20_000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctrl = controllerRef as ReadableStreamDefaultController<any> | null;
      if (!active || !ctrl) break;
      try {
        ctrl.enqueue(encoder.encode(`: ping\n\n`));
      } catch {
        break;
      }
    }
  })();

  // Clean up on client disconnect. Keep lastReadIndex / etagCache /
  // lastPolledAt across reconnects so a flapping client cannot reset state.
  req.signal.addEventListener("abort", () => {
    active = false;
    unsubscribe?.();
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
