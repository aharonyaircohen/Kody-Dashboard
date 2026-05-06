/**
 * @fileType hook
 * @domain kody
 * @pattern interactive-session
 *
 * Client-side state machine for the long-lived "interactive runner" chat
 * mode. Encapsulates the start/append/end actions, the SSE stream
 * (with mode=interactive), and the lifecycle event handlers (chat.ready /
 * chat.exit).
 *
 * This is intentionally a pure-logic hook — no UI. Designed to be embedded
 * in a thin demo page first (/interactive) and later in KodyChat once the
 * end-to-end wiring is validated against the real engine.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getStoredAuth } from "../api";

export type InteractiveState = "idle" | "booting" | "ready" | "ended";

export interface InteractiveMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface UseInteractiveSessionResult {
  state: InteractiveState;
  sessionId: string | null;
  messages: InteractiveMessage[];
  error: string | null;
  /** Last chat.exit reason — set after the runner ends. */
  exitReason: string | null;
  start: (opts?: { idleExitMs?: number; hardCapMs?: number }) => Promise<void>;
  send: (content: string) => Promise<void>;
}

function authHeaders(): Record<string, string> {
  const auth = getStoredAuth();
  return auth
    ? { "x-kody-token": auth.token, "x-kody-owner": auth.owner, "x-kody-repo": auth.repo }
    : {};
}

function newSessionId(): string {
  return `interactive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useInteractiveSession(): UseInteractiveSessionResult {
  const [state, setState] = useState<InteractiveState>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<InteractiveMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exitReason, setExitReason] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Close the stream on unmount so a navigated-away tab doesn't keep
  // an idle SSE open against Vercel's per-instance budget.
  useEffect(() => {
    return () => eventSourceRef.current?.close();
  }, []);

  const openStream = useCallback((id: string) => {
    eventSourceRef.current?.close();

    const auth = getStoredAuth();
    const params = new URLSearchParams({ taskId: id, mode: "interactive" });
    if (auth) {
      params.set("owner", auth.owner);
      params.set("repo", auth.repo);
      params.set("token", auth.token);
    }
    const es = new EventSource(`/api/kody/events/stream?${params.toString()}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      if (!event.data) return;
      try {
        const parsed = JSON.parse(event.data) as Record<string, unknown>;
        switch (parsed.type) {
          case "connected":
            return;
          case "chat.ready":
            setState("ready");
            return;
          case "chat.message": {
            const role = parsed.role === "user" ? "user" : "assistant";
            const content = typeof parsed.content === "string" ? parsed.content : "";
            const timestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString();
            setMessages((prev) => [...prev, { role, content, timestamp }]);
            return;
          }
          case "chat.done":
            // End-of-turn signal in interactive mode — runner is back to polling.
            return;
          case "chat.error":
            setError(typeof parsed.error === "string" ? parsed.error : "unknown error");
            return;
          case "chat.exit":
            setExitReason(typeof parsed.reason === "string" ? parsed.reason : "ended");
            setState("ended");
            es.close();
            return;
        }
      } catch {
        // skip malformed
      }
    };

    es.onerror = () => {
      // SSE connections drop frequently in dev (HMR) — don't transition to
      // "ended" on transient errors. The browser auto-reconnects.
    };
  }, []);

  const start = useCallback(
    async (opts: { idleExitMs?: number; hardCapMs?: number } = {}) => {
      if (state !== "idle" && state !== "ended") return;

      const id = newSessionId();
      setSessionId(id);
      setMessages([]);
      setError(null);
      setExitReason(null);
      setState("booting");

      try {
        const dashboardUrl =
          typeof window !== "undefined" ? `${window.location.origin}/api/kody/events/ingest` : undefined;
        const res = await fetch("/api/kody/chat/interactive/start", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            taskId: id,
            dashboardUrl,
            idleExitMs: opts.idleExitMs,
            hardCapMs: opts.hardCapMs,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }

        // Open the SSE *before* the runner starts emitting — chat.ready may
        // arrive within seconds.
        openStream(id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "start failed";
        setError(msg);
        setState("ended");
      }
    },
    [state, openStream],
  );

  const send = useCallback(
    async (content: string) => {
      if (state !== "ready" || !sessionId || !content.trim()) return;

      const ts = new Date().toISOString();
      // Optimistic UI update — the runner's reply will arrive via SSE and
      // get appended after this user turn.
      setMessages((prev) => [...prev, { role: "user", content, timestamp: ts }]);

      try {
        const res = await fetch("/api/kody/chat/interactive/append", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ taskId: sessionId, content, timestamp: ts }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "send failed";
        setError(msg);
      }
    },
    [state, sessionId],
  );

  return { state, sessionId, messages, error, exitReason, start, send };
}
