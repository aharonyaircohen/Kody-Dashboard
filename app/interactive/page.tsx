/**
 * @fileType page
 * @domain kody
 * @pattern interactive-runner-demo
 *
 * Standalone demo page for the long-lived "Interactive Runner" chat mode.
 * Lives outside KodyChat.tsx (1900+ lines) so the spike can validate the
 * end-to-end dashboard wiring without risking the existing one-shot path.
 *
 * Once validated, the integration into KodyChat is straightforward:
 * import + use `useInteractiveSession`, branch the send-message handler
 * on session state, render the Start button somewhere in the agent header.
 */

"use client";

import { useState, useEffect, useRef } from "react";
import { useInteractiveSession } from "@dashboard/lib/hooks/useInteractiveSession";

export default function InteractivePage() {
  const { state, sessionId, messages, error, exitReason, start, send } = useInteractiveSession();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || state !== "ready") return;
    const content = input.trim();
    setInput("");
    await send(content);
  };

  return (
    <main className="mx-auto flex h-screen max-w-3xl flex-col p-6">
      <header className="mb-4 flex items-center justify-between border-b pb-3">
        <div>
          <h1 className="text-xl font-semibold">Interactive Runner</h1>
          <p className="text-xs text-muted-foreground">
            Long-lived GitHub Actions runner that polls a session JSONL for new messages. Multi-turn
            chat without a workflow dispatch per message.
          </p>
        </div>
        <StatusPill state={state} exitReason={exitReason} />
      </header>

      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => start({ idleExitMs: 120_000, hardCapMs: 600_000 })}
          disabled={state === "booting" || state === "ready"}
          className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {state === "ended" || state === "idle" ? "Create Interactive Session" : "Session in progress"}
        </button>
        {sessionId ? (
          <code className="text-xs text-muted-foreground">{sessionId}</code>
        ) : null}
      </div>

      {error ? (
        <div className="mb-3 rounded border border-destructive bg-destructive/10 p-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto rounded border p-3">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {state === "idle" || state === "ended"
              ? "Click \"Create Interactive Session\" to start a long-lived runner."
              : state === "booting"
                ? "Waiting for runner to boot... (~90s on first dispatch — npx install + LiteLLM startup)"
                : "Runner is ready. Type a message below."}
          </p>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`mb-3 ${m.role === "user" ? "text-right" : ""}`}>
              <div
                className={`inline-block max-w-[80%] rounded px-3 py-2 text-sm ${
                  m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
              >
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {new Date(m.timestamp).toLocaleTimeString()}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder={state === "ready" ? "Type a message..." : "Start a session to chat"}
          disabled={state !== "ready"}
          className="flex-1 rounded border px-3 py-2 text-sm disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={state !== "ready" || !input.trim()}
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </main>
  );
}

function StatusPill({ state, exitReason }: { state: string; exitReason: string | null }) {
  const palette: Record<string, string> = {
    idle: "bg-muted text-muted-foreground",
    booting: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100",
    ready: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100",
    ended: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  };
  const label = state === "ended" && exitReason ? `ended (${exitReason})` : state;
  return (
    <span className={`rounded px-2 py-1 text-xs font-medium ${palette[state] ?? palette.idle}`}>
      {label}
    </span>
  );
}
