/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern server-sent-events
 *
 * GET /api/kody/events/stream?taskId=xxx
 *
 * Server-Sent Events endpoint for real-time chat streaming.
 * Polls the engine's local event file for new chat events matching the sessionId.
 *
 * Events are streamed in SSE format: `data: {json}\n\n`
 *
 * Terminal events: `chat.done`, `chat.error` — endpoint closes after these.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireKodyAuth } from "@dashboard/lib/auth";
import * as fs from "fs";
import * as path from "path";

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

// Track last-read position per taskId to avoid re-reading old events
const lastReadIndex = new Map<string, number>();

// Map of sessionId → set of active controllers
const activeControllers = new Map<string, Set<ReadableStreamDefaultController>>();

// ─── Event file path ──────────────────────────────────────────────────────────

function getEventFilePath(sessionId: string): string {
  // Path to the engine's local event file (written by the chat workflow)
  // In production, this could be replaced with Vercel Blob or a shared Redis key
  const engineRepoPath = process.env.KODY_ENGINE_LOCAL_PATH ??
    path.join(process.cwd(), "..", "Kody-ADE-Engine");
  return path.join(engineRepoPath, ".kody", "events", `${sessionId}.jsonl`);
}

// ─── Polling helper ───────────────────────────────────────────────────────────

function readNewEvents(sessionId: string): ChatEventEntry[] {
  const filePath = getEventFilePath(sessionId);
  if (!fs.existsSync(filePath)) return [];

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    const startIndex = lastReadIndex.get(sessionId) ?? 0;
    const newLines = lines.slice(startIndex);

    if (newLines.length > 0) {
      lastReadIndex.set(sessionId, lines.length);
    }

    return newLines
      .map((line) => {
        try { return JSON.parse(line) as ChatEventEntry; }
        catch { return null; }
      })
      .filter((e): e is ChatEventEntry => e !== null);
  } catch {
    return [];
  }
}

// ─── Register / unregister controllers ─────────────────────────────────────────

function addController(sessionId: string, controller: ReadableStreamDefaultController): () => void {
  if (!activeControllers.has(sessionId)) {
    activeControllers.set(sessionId, new Set());
  }
  activeControllers.get(sessionId)!.add(controller);

  return () => {
    activeControllers.get(sessionId)?.delete(controller);
    if (activeControllers.get(sessionId)?.size === 0) {
      activeControllers.delete(sessionId);
    }
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const sessionId = req.nextUrl.searchParams.get("taskId");
  if (!sessionId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  // ?test=1 — non-streaming mode for integration tests.
  // Returns headers as a JSON body so the test can verify Content-Type
  // without needing to consume an infinite SSE stream.
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

  let cleanup: (() => void) | null = null;
  let controllerRef: ReadableStreamDefaultController | null = null;

  const stream = new ReadableStream({
    start(controller) {
      controllerRef = controller as ReadableStreamDefaultController;
      cleanup = addController(sessionId, controller as ReadableStreamDefaultController);
    },
    cancel() {
      cleanup?.();
      lastReadIndex.delete(sessionId);
    },
  });

  // Stream events into the SSE response
  const encoder = new TextEncoder();
  let active = true;

  const poll = setInterval(() => {
    if (!active) return;
    const events = readNewEvents(sessionId);
    for (const event of events) {
      if (event.event === "chat.done" || event.event === "chat.error") {
        const data = event.event === "chat.done"
          ? JSON.stringify({ type: "chat.done", sessionId, runId: event.runId })
          : JSON.stringify({ type: "chat.error", sessionId, error: event.payload.error });
        if (controllerRef) {
          try {
            (controllerRef as ReadableStreamDefaultController).enqueue(encoder.encode(`data: ${data}\n\n`));
          } catch { /* closed */ }
        }
        active = false;
        clearInterval(poll);
        controllerRef?.close();
        cleanup?.();
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
        if (controllerRef) {
          try {
            (controllerRef as ReadableStreamDefaultController).enqueue(encoder.encode(`data: ${data}\n\n`));
          } catch { /* closed */ }
        }
      }
    }
  }, 1000);

  // Initial connected heartbeat
  if (controllerRef) {
    try {
      (controllerRef as ReadableStreamDefaultController).enqueue(encoder.encode(
        `data: ${JSON.stringify({ type: "connected", sessionId })}\n\n`,
      ));
    } catch { /* closed */ }
  }

  // Clean up on client disconnect
  req.signal.addEventListener("abort", () => {
    active = false;
    clearInterval(poll);
    lastReadIndex.delete(sessionId);
    cleanup?.();
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Disable Nginx buffering for SSE
    },
  });
}
