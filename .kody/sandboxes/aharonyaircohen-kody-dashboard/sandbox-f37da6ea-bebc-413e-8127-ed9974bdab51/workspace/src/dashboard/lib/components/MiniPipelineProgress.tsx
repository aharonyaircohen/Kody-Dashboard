/**
 * @fileType component
 * @domain kody
 * @pattern pipeline-progress
 * @ai-summary Compact pipeline progress indicator with two variants: "inline" (small bar + percent for metadata line) and "bar" (full progress bar for dedicated row). Both use a monotonic overall-percent bar colored by current phase (spec=sky, impl=violet, autofix=amber). Tick marks under the bar mark the phase boundaries; never regresses when the orchestrator switches phases.
 */
"use client";

import { useState, useEffect, useRef } from "react";
import { cn } from "../utils";
import type { KodyTask } from "../types";
import { ALL_STAGES, SPEC_STAGES, IMPL_STAGES } from "../constants";
import {
  derivePipelineDisplayState,
  formatElapsed,
  getStagePhase,
  getWeightedActiveProgress,
  PHASE_CLASSES,
  type PipelinePhase,
} from "../pipeline-utils";
import { Loader2, Timer, Pause, ExternalLink } from "lucide-react";

interface MiniPipelineProgressProps {
  task: KodyTask;
  className?: string;
  /** "inline" = compact bar+percent for metadata line; "bar" = full progress bar for dedicated row */
  variant?: "inline" | "bar";
}

// Phase boundary positions on the 12-stage timeline (cumulative fractions).
// SPEC_STAGES (3) | IMPL_STAGES (8) | AUTOFIX (1)  →  3/12, 11/12
const SPEC_BOUNDARY = SPEC_STAGES.length / ALL_STAGES.length;
const IMPL_BOUNDARY =
  (SPEC_STAGES.length + IMPL_STAGES.length) / ALL_STAGES.length;

/**
 * Compact pipeline progress for task list cards.
 *
 * Both variants render a single monotonic overall-percent bar colored by the
 * current phase (spec=sky, impl=violet, autofix=amber). Two tick marks
 * underneath show the spec→impl and impl→autofix boundaries.
 *
 * The bar uses `getWeightedActiveProgress` which combines stage completion
 * weight with a wall-clock time floor — it never regresses when the engine
 * switches phases or re-runs a step.
 */
export function MiniPipelineProgress({
  task,
  className,
  variant = "inline",
}: MiniPipelineProgressProps) {
  const [, setTick] = useState(0);
  const isActive =
    task.column === "building" ||
    task.column === "retrying" ||
    task.column === "gate-waiting";

  // Tick every 5 seconds to keep elapsed time + time-floor progress fresh
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(interval);
  }, [isActive]);

  if (!isActive) return null;

  const displayState = derivePipelineDisplayState(task);

  if (variant === "bar") {
    return (
      <BarVariant
        displayState={displayState}
        task={task}
        className={className}
      />
    );
  }

  return (
    <InlineVariant
      displayState={displayState}
      task={task}
      className={className}
    />
  );
}

// ══════════════════════════════════════════════════════
// MONOTONIC PROGRESS HOOK
// ══════════════════════════════════════════════════════

/**
 * Returns the larger of `current` or the highest value seen this session,
 * so the bar never goes backward when stage data shifts (e.g. orchestrator
 * switches phases, autofix kicks in, engine re-emits earlier stages).
 */
function useMonotonicPercent(current: number, taskId: string): number {
  const ref = useRef<{ id: string; max: number }>({ id: taskId, max: current });
  if (ref.current.id !== taskId) {
    ref.current = { id: taskId, max: current };
  } else if (current > ref.current.max) {
    ref.current.max = current;
  }
  return ref.current.max;
}

// ══════════════════════════════════════════════════════
// INLINE VARIANT — for the metadata dot-separator line
// ══════════════════════════════════════════════════════

function InlineVariant({
  displayState,
  task,
  className,
}: {
  displayState: ReturnType<typeof derivePipelineDisplayState>;
  task: KodyTask;
  className?: string;
}) {
  const rawPercent = getWeightedActiveProgress(task);
  const percent = useMonotonicPercent(rawPercent, task.id);

  switch (displayState.kind) {
    case "stage-progress": {
      const phase = getStagePhase(task.pipeline?.currentStage);
      return (
        <span className={cn("inline-flex items-center gap-1.5", className)}>
          <PhaseBar
            percent={percent}
            phase={phase}
            state="running"
            width="w-20"
          />
          <span className="text-[10px] text-zinc-400 font-mono tabular-nums">
            {Math.round(percent)}%
          </span>
        </span>
      );
    }

    case "gate-paused": {
      const phase = getStagePhase(task.pipeline?.currentStage);
      return (
        <span className={cn("inline-flex items-center gap-1.5", className)}>
          <PhaseBar
            percent={percent}
            phase={phase}
            state="paused"
            width="w-20"
          />
          <Pause className="w-3 h-3 text-yellow-400" />
        </span>
      );
    }

    case "starting":
    case "no-data":
      return (
        <span className={cn("inline-flex items-center gap-1", className)}>
          <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
        </span>
      );
  }
}

// ══════════════════════════════════════════════════════
// BAR VARIANT — for the dedicated progress row
// ══════════════════════════════════════════════════════

function BarVariant({
  displayState,
  task,
  className,
}: {
  displayState: ReturnType<typeof derivePipelineDisplayState>;
  task: KodyTask;
  className?: string;
}) {
  const workflowRun = task.workflowRun;
  const pipeline = task.pipeline;
  const rawPercent = getWeightedActiveProgress(task);
  const percent = useMonotonicPercent(rawPercent, task.id);

  switch (displayState.kind) {
    case "stage-progress": {
      const phase = getStagePhase(pipeline?.currentStage);
      const phaseStyle = PHASE_CLASSES[phase];
      return (
        <div className={cn("flex items-center gap-2", className)}>
          <PhaseBar
            percent={percent}
            phase={phase}
            state="running"
            width="w-32"
          />
          <span className="text-[10px] text-zinc-400 font-mono tabular-nums">
            {Math.round(percent)}%
          </span>
          <span
            className={cn(
              "text-[11px] font-medium truncate max-w-28",
              phaseStyle.text,
            )}
          >
            {displayState.label}
          </span>
          <ElapsedBadge since={pipeline?.startedAt} />
          {workflowRun?.html_url && (
            <a
              href={workflowRun.html_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-zinc-500 hover:text-blue-400 transition-colors"
              title="View GitHub Actions workflow run"
            >
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
        </div>
      );
    }

    case "gate-paused": {
      const phase = getStagePhase(pipeline?.currentStage);
      return (
        <div className={cn("flex items-center gap-2", className)}>
          <PhaseBar
            percent={percent}
            phase={phase}
            state="paused"
            width="w-32"
          />
          <Pause className="w-3 h-3 text-yellow-400" />
          <span className="text-[11px] text-yellow-400 font-medium">
            Paused · {displayState.label}
          </span>
          <ElapsedBadge since={pipeline?.startedAt} />
        </div>
      );
    }

    case "starting":
      return (
        <div className={cn("flex items-center gap-2", className)}>
          <div className="w-32 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
            <div className="h-full w-1/3 bg-gradient-to-r from-violet-500/0 via-violet-400 to-violet-500/0 rounded-full animate-shimmer" />
          </div>
          <span className="text-[11px] text-violet-300/80">Starting...</span>
          <ElapsedBadge since={pipeline?.startedAt} />
        </div>
      );

    case "no-data": {
      const startTime = workflowRun?.created_at || task.updatedAt;
      const wfStatus = workflowRun?.status;
      return (
        <div className={cn("flex items-center gap-2", className)}>
          <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
          <span className="text-[11px] text-blue-400/80">
            {wfStatus === "in_progress"
              ? "Pipeline running..."
              : wfStatus === "queued"
                ? "Queued..."
                : wfStatus === "completed"
                  ? "Finishing up..."
                  : "Starting..."}
          </span>
          {workflowRun?.html_url && (
            <a
              href={workflowRun.html_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-zinc-500 hover:text-blue-400 transition-colors"
              title="View GitHub Actions workflow run"
            >
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
          <ElapsedBadge since={startTime} />
        </div>
      );
    }
  }
}

// ══════════════════════════════════════════════════════
// SHARED SUBCOMPONENTS
// ══════════════════════════════════════════════════════

/**
 * Monotonic phase-colored progress bar with phase-boundary tick marks.
 *
 * Layout: thin track (zinc) with a phase-colored fill. Two ticks at the
 * spec→impl and impl→autofix boundaries make phase transitions visible
 * without needing per-stage dots.
 */
function PhaseBar({
  percent,
  phase,
  state,
  width,
}: {
  percent: number;
  phase: PipelinePhase;
  state: "running" | "paused";
  width: string;
}) {
  const phaseStyle = PHASE_CLASSES[phase];
  const fillClass = state === "paused" ? "bg-yellow-400" : phaseStyle.bar;
  const glowClass = state === "paused" ? "" : phaseStyle.glow;
  const clamped = Math.max(0, Math.min(99, percent));

  return (
    <div
      className={cn(
        "relative h-1.5 bg-zinc-700/70 rounded-full overflow-visible",
        width,
      )}
    >
      <div className="absolute inset-0 rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-out",
            fillClass,
            glowClass,
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {/* Phase boundary ticks */}
      <div
        className="absolute top-1/2 -translate-y-1/2 w-px h-2 bg-zinc-500/70"
        style={{ left: `${SPEC_BOUNDARY * 100}%` }}
        title="Spec → Build"
      />
      <div
        className="absolute top-1/2 -translate-y-1/2 w-px h-2 bg-zinc-500/70"
        style={{ left: `${IMPL_BOUNDARY * 100}%` }}
        title="Build → Auto-fix"
      />
    </div>
  );
}

/** Elapsed time badge with timer icon */
function ElapsedBadge({ since }: { since?: string | null }) {
  if (!since) return null;
  return (
    <span className="text-[10px] text-zinc-500 font-mono tabular-nums flex items-center gap-0.5">
      <Timer className="w-2.5 h-2.5" />
      {formatElapsed(new Date(since))}
    </span>
  );
}
