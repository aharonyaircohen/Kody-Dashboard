/**
 * @fileType component
 * @domain kody
 * @pattern action-status-badge
 * @ai-summary Shows live engine action state (running/waiting) for a task. Renders nothing when idle.
 */
"use client";

import { useKodyActionState } from "../hooks/useKodyActionState";
import { cn } from "../utils";
import { SimpleTooltip } from "./SimpleTooltip";

interface ActionStatusBadgeProps {
  taskId: string | null | undefined;
  className?: string;
}

export function ActionStatusBadge({
  taskId,
  className,
}: ActionStatusBadgeProps) {
  const { state } = useKodyActionState(taskId);

  if (!state) return null;
  if (state.status !== "running" && state.status !== "waiting") return null;

  const isRunning = state.status === "running";
  const dotColor = isRunning ? "bg-emerald-400" : "bg-amber-400";
  const textColor = isRunning ? "text-emerald-300" : "text-amber-300";
  const label = isRunning ? "Running" : "Waiting on you";

  const tooltip = (
    <div className="space-y-1 text-xs">
      <div className="font-medium">
        {isRunning ? "Engine is running" : "Engine is waiting for input"}
      </div>
      {state.step && (
        <div className="text-zinc-400">
          Step: <code className="px-1 rounded bg-zinc-800">{state.step}</code>
        </div>
      )}
      {state.lastHeartbeat && (
        <div className="text-zinc-500">
          Last heartbeat: {new Date(state.lastHeartbeat).toLocaleTimeString()}
        </div>
      )}
    </div>
  );

  return (
    <SimpleTooltip content={tooltip} side="bottom">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium",
          "bg-zinc-900 border border-zinc-800",
          textColor,
          className,
        )}
      >
        <span className="relative flex h-2 w-2">
          {isRunning && (
            <span
              className={cn(
                "absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping",
                dotColor,
              )}
            />
          )}
          <span
            className={cn(
              "relative inline-flex h-2 w-2 rounded-full",
              dotColor,
            )}
          />
        </span>
        <span className="truncate max-w-[140px]">
          {label}
          {isRunning && state.step ? ` · ${state.step}` : ""}
        </span>
      </span>
    </SimpleTooltip>
  );
}
