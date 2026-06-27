/**
 * @fileType component
 * @domain kody
 * @pattern vibe-run-button
 * @ai-summary Selected-issue action for the Vibe page. Spawns a Fly Machine
 *   in agent mode against the selected task's issue — the engine reads the
 *   issue body as its plan, implements it, commits, and opens a PR. Hides
 *   itself once any work has started (column !== 'open') so the same
 *   execution doesn't get fired twice.
 */
"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Loader2, Play } from "lucide-react";

import { vibeApi } from "../api";
import type { KodyTask } from "../types";

interface VibeRunButtonProps {
  issueNumber: number;
  column?: KodyTask["column"] | null;
  onDispatched?: () => void;
}

export function VibeRunButton({
  issueNumber,
  column,
  onDispatched,
}: VibeRunButtonProps) {
  const [running, setRunning] = useState(false);

  const handleClick = useCallback(async () => {
    setRunning(true);
    try {
      await vibeApi.execute(issueNumber);
      toast.success(`Kody dispatched on #${issueNumber}`);
      onDispatched?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run Kody");
    } finally {
      setRunning(false);
    }
  }, [issueNumber, onDispatched]);

  // Once any lifecycle has started, the engine's run executable has set
  // a label that moves the task off `open`. Hide the button — repeat
  // execution would just stomp on an existing branch / PR.
  if (column && column !== "open") return null;

  return (
    <div className="w-full max-w-md flex items-center justify-between gap-2 rounded-md border border-fuchsia-500/30 bg-fuchsia-500/10 px-2 py-1.5">
      <span className="text-xs text-fuchsia-200/90 truncate">
        Ready to ship? Hand the plan to the engine.
      </span>
      <button
        type="button"
        onClick={handleClick}
        disabled={running}
        title={`Run Kody on issue #${issueNumber}`}
        aria-label="Run Kody on this issue"
        className="inline-flex items-center gap-1.5 shrink-0 text-xs font-semibold px-2.5 py-1 rounded-md bg-fuchsia-500/25 text-fuchsia-100 hover:bg-fuchsia-500/40 border border-fuchsia-500/40 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {running ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Play className="w-3 h-3" />
        )}
        {running ? "Dispatching…" : `Run Kody on #${issueNumber}`}
      </button>
    </div>
  );
}
