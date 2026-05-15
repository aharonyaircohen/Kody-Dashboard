/**
 * @fileType utility
 * @domain kody
 * @pattern pipeline-progress
 * @ai-summary Shared pipeline progress utilities — stage labels, progress calculation, elapsed formatting, tooltips
 */

import {
  ALL_STAGES,
  SPEC_STAGES,
  IMPL_STAGES,
  AUTOFIX_STAGE,
} from "./constants";
import type { KodyPipelineStatus, KodyTask, StageStatus } from "./types";

// ══════════════════════════════════════════════════════
// PHASE GROUPING — color pipeline stages by phase group
// ══════════════════════════════════════════════════════

export type PipelinePhase = "spec" | "impl" | "autofix";

const SPEC_SET = new Set<string>(SPEC_STAGES);
const IMPL_SET = new Set<string>(IMPL_STAGES);

/**
 * Map a stage name to its phase group. Unknown/engine-specific stages
 * (e.g. `gsd-execute`, `test`, `ship`) default to 'impl' since most
 * non-spec runtime stages are part of the build phase.
 */
export function getStagePhase(stage: string | null | undefined): PipelinePhase {
  if (!stage) return "impl";
  if (SPEC_SET.has(stage)) return "spec";
  if (stage === AUTOFIX_STAGE) return "autofix";
  if (IMPL_SET.has(stage)) return "impl";
  return "impl";
}

/**
 * Tailwind classes per phase. Sky = planning/spec, violet = build/impl,
 * amber = recovery/autofix. Yellow stays reserved for gate-paused, red for
 * failure — don't use those here.
 */
export const PHASE_CLASSES: Record<
  PipelinePhase,
  {
    bar: string;
    dot: string;
    dotActive: string;
    glow: string;
    text: string;
    label: string;
  }
> = {
  spec: {
    bar: "bg-sky-400",
    dot: "bg-sky-500",
    dotActive: "bg-sky-300",
    glow: "shadow-[0_0_4px_rgba(56,189,248,0.6)]",
    text: "text-sky-300",
    label: "Spec",
  },
  impl: {
    bar: "bg-violet-400",
    dot: "bg-violet-500",
    dotActive: "bg-violet-300",
    glow: "shadow-[0_0_4px_rgba(167,139,250,0.6)]",
    text: "text-violet-300",
    label: "Build",
  },
  autofix: {
    bar: "bg-amber-400",
    dot: "bg-amber-500",
    dotActive: "bg-amber-300",
    glow: "shadow-[0_0_4px_rgba(251,191,36,0.6)]",
    text: "text-amber-300",
    label: "Auto-fix",
  },
};

/**
 * Human-readable labels for each pipeline stage
 */
export const stageLabels: Record<string, string> = {
  taskify: "Classifying",
  gap: "Checking Gaps",
  clarify: "Clarifying",
  architect: "Planning",
  "plan-gap": "Reviewing Plan",
  build: "Building",
  commit: "Committing",
  review: "Reviewing",
  fix: "Fixing",
  verify: "Verifying",
  pr: "Creating PR",
  autofix: "Auto-fixing",
};

/**
 * Typical max durations per stage (in ms) for estimating progress percentage
 */
export const stageMaxDurations: Record<string, number> = {
  taskify: 10 * 60 * 1000,
  clarify: 10 * 60 * 1000,
  architect: 30 * 60 * 1000,
  "plan-gap": 15 * 60 * 1000,
  build: 45 * 60 * 1000,
  commit: 5 * 60 * 1000,
  review: 15 * 60 * 1000,
  fix: 20 * 60 * 1000,
  verify: 15 * 60 * 1000,
  pr: 5 * 60 * 1000,
  autofix: 15 * 60 * 1000,
};

const DEFAULT_MAX_MS = 20 * 60 * 1000;

export interface PipelineProgress {
  /** Index of the current stage in ALL_STAGES (0-based). -1 if unknown */
  currentStageIndex: number;
  /** Total number of stages */
  totalStages: number;
  /** Human-readable label for the current stage */
  currentStageLabel: string;
  /** Step number (1-based) */
  stepNumber: number;
  /** Estimated percentage within the current stage (0-99) */
  stagePercent: number;
  /** Estimated overall percentage (0-99) */
  overallPercent: number;
  /** Number of completed stages */
  completedStages: number;
  /** Pipeline state */
  state: KodyPipelineStatus["state"];
}

/**
 * Calculate pipeline progress from a KodyPipelineStatus object
 */
export function calculatePipelineProgress(
  pipeline: KodyPipelineStatus,
): PipelineProgress {
  const totalStages = ALL_STAGES.length;
  const currentStage = pipeline.currentStage;
  const currentStageIndex = currentStage
    ? ALL_STAGES.indexOf(currentStage as (typeof ALL_STAGES)[number])
    : -1;

  const completedStages = Object.values(pipeline.stages || {}).filter(
    (s) => s.state === "completed" || s.state === "skipped",
  ).length;

  // Stage percent from elapsed time
  let stagePercent = 0;
  if (currentStage && pipeline.stages?.[currentStage]?.elapsed) {
    const elapsed = pipeline.stages[currentStage].elapsed! * 1000;
    const maxMs = stageMaxDurations[currentStage] || DEFAULT_MAX_MS;
    stagePercent = Math.min(99, Math.round((elapsed / maxMs) * 100));
  }

  // Overall percent: completed stages + fractional current stage
  const overallPercent =
    totalStages > 0
      ? Math.min(
          99,
          Math.round(
            ((completedStages + stagePercent / 100) / totalStages) * 100,
          ),
        )
      : 0;

  return {
    currentStageIndex,
    totalStages,
    currentStageLabel: currentStage
      ? stageLabels[currentStage] || currentStage
      : "Starting...",
    stepNumber:
      currentStageIndex >= 0 ? currentStageIndex + 1 : completedStages + 1,
    stagePercent,
    overallPercent,
    completedStages,
    state: pipeline.state,
  };
}

/**
 * Compute live elapsed-ms for a stage. For a running stage, uses
 * `Date.now() - startedAt` so the value advances continuously between polls.
 * Falls back to the snapshotted `elapsed` field when `startedAt` is missing.
 */
function getStageElapsedMs(data: StageStatus): number {
  if (data.state === "running" && data.startedAt) {
    return Math.max(0, Date.now() - new Date(data.startedAt).getTime());
  }
  if (data.elapsed) return data.elapsed * 1000;
  if (data.startedAt && data.completedAt) {
    return Math.max(
      0,
      new Date(data.completedAt).getTime() - new Date(data.startedAt).getTime(),
    );
  }
  return 0;
}

/**
 * Asymptotic fill curve for the running stage: 1 - exp(-elapsed/median).
 *
 * At elapsed = median, fill = 0.63. At 2× median, 0.86. At 3× median, 0.95.
 * Feels responsive at the start (avoids the "stuck" feel of linear elapsed/max
 * with very generous max durations) without ever exceeding the segment.
 */
function stageFillFraction(stage: string, data: StageStatus): number {
  const max = stageMaxDurations[stage] || DEFAULT_MAX_MS;
  const median = max / 3;
  const elapsedMs = getStageElapsedMs(data);
  if (elapsedMs <= 0) return 0;
  const frac = 1 - Math.exp(-elapsedMs / median);
  return Math.min(0.95, frac);
}

/**
 * Stages tracked for *this* pipeline run, in execution order.
 *
 * The kody engine writes stages incrementally with a wide vocabulary
 * (`spec`, `gsd-research`, `plan`, `test`, `ship`, etc.) that doesn't fully
 * overlap with the dashboard's `ALL_STAGES` constant. Filtering through
 * ALL_STAGES used to drop most real stages and made the progress bar appear
 * stuck. We now use the engine's actual stages map (insertion-ordered) so
 * unknown stages still count.
 */
function getTrackedStages(stages: Record<string, StageStatus>): string[] {
  return Object.keys(stages);
}

/**
 * Time-based asymptotic progress floor (0-95). Uses `pipeline.startedAt` and a
 * 30-minute median curve so the bar advances continuously over wall-clock time
 * even when stage data is sparse, contains stages the dashboard doesn't know
 * about, or stalls between engine polls. At 30min: 63%; at 60min: 86%; at
 * 90min: 95%. Capped at 95 to leave headroom for "in progress" visual cue.
 */
function getTimeBasedProgress(task: KodyTask): number {
  const startedAt = task.pipeline?.startedAt;
  if (!startedAt) return 0;
  const elapsedMs = Math.max(0, Date.now() - new Date(startedAt).getTime());
  if (elapsedMs <= 0) return 0;
  const median = 30 * 60 * 1000;
  const frac = 1 - Math.exp(-elapsedMs / median);
  return Math.min(95, frac * 100);
}

/**
 * Cumulative-weight stage boundaries (0-1) for tick marks on the progress bar.
 *
 * Returns one entry per stage in `pipeline.stages` (insertion order = engine's
 * execution order), with `position` = fraction-of-total-weight where that
 * stage *ends*. Unknown stages use DEFAULT_MAX_MS so they still get a tick.
 */
export function getStageBoundaries(
  task: KodyTask,
): Array<{ stage: string; position: number; isCompleted: boolean }> {
  const pipeline = task.pipeline;
  if (!pipeline) return [];
  const stages = pipeline.stages || {};
  const tracked = getTrackedStages(stages);
  const totalWeight = tracked.reduce(
    (sum, s) => sum + (stageMaxDurations[s] || DEFAULT_MAX_MS),
    0,
  );
  if (totalWeight === 0) return [];

  let cumulative = 0;
  return tracked.map((stage) => {
    cumulative += stageMaxDurations[stage] || DEFAULT_MAX_MS;
    const data = stages[stage];
    const isCompleted = data.state === "completed" || data.state === "skipped";
    return { stage, position: cumulative / totalWeight, isCompleted };
  });
}

/**
 * Weighted overall progress (0-99) for an active task.
 *
 * Combines two signals so the bar always advances visibly:
 *  - **Stage-based**: walks `pipeline.stages` in engine insertion order,
 *    summing weights for completed/skipped stages and an asymptotic fill for
 *    the currently-running one. Uses the engine's full stage vocabulary, not
 *    just `ALL_STAGES`, so stages like `spec`/`gsd-execute`/`test`/`ship` count.
 *  - **Time-based**: asymptotic floor from `pipeline.startedAt` so wall-clock
 *    time alone keeps the bar moving between engine polls.
 *
 * Returns the larger of the two, capped at 99.
 */
export function getWeightedActiveProgress(task: KodyTask): number {
  const pipeline = task.pipeline;
  if (!pipeline) return 0;

  const stages = pipeline.stages || {};
  const tracked = getTrackedStages(stages);

  let stageBased = 0;
  if (tracked.length > 0) {
    const totalWeight = tracked.reduce(
      (sum, s) => sum + (stageMaxDurations[s] || DEFAULT_MAX_MS),
      0,
    );
    if (totalWeight > 0) {
      let cumulative = 0;
      for (const stage of tracked) {
        const weight = stageMaxDurations[stage] || DEFAULT_MAX_MS;
        const data = stages[stage];

        if (data.state === "completed" || data.state === "skipped") {
          cumulative += weight;
          continue;
        }

        if (data.state === "running") {
          cumulative += weight * stageFillFraction(stage, data);
          break;
        }

        // pending / failed / timeout / gate-waiting / paused — stop accumulating
        break;
      }
      stageBased = (cumulative / totalWeight) * 100;
    }
  }

  const timeBased = getTimeBasedProgress(task);
  return Math.min(99, Math.max(stageBased, timeBased));
}

/**
 * Gradual progress (65-96) for the review column — replaces the old
 * "any open PR ⇒ 100%" heuristic so the bar can distinguish:
 *   - kody bailed mid-flow (PR opened but a kody:* label still on the PR)
 *   - CI failing on the PR
 *   - merge conflicts / not mergeable
 *   - checks running
 *   - all green and ready for human merge
 *
 * Only `done` (merged) hits 100%. Returns 85 when no PR is associated
 * (rare — review column is reached only when the task has an open PR,
 * but defensive default keeps the bar visible).
 */
export function getReviewPercent(task: KodyTask): number {
  const pr = task.associatedPR;
  if (!pr) return 85;

  const prLabels = pr.labels ?? [];
  // Mid-flow kody label still on the PR ⇒ kody hasn't actually finished.
  // Same group as the issue's lifecycle (prefix `kody:`), but on the PR
  // these stick around when sync/fix runs and isn't followed up.
  const kodyMidFlow = prLabels.some(
    (l) =>
      l === "kody:syncing" ||
      l === "kody:fixing" ||
      l === "kody:failed" ||
      l === "kody:resolving" ||
      l === "kody:reviewing",
  );
  if (kodyMidFlow) return 70;

  if (pr.hasConflicts || pr.mergeable === false) return 75;

  switch (pr.ciStatus) {
    case "failure":
      return 65;
    case "pending":
    case "running":
      return 82;
    case "success":
      return 96;
    default:
      return 88;
  }
}

/**
 * Format elapsed time since a date, updating live
 */
export function formatElapsed(since: Date): string {
  const ms = Date.now() - since.getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * Generate a rich tooltip title for a pipeline stage
 * Includes stage label, state, elapsed time, and error if present
 */
export function getStageTooltip(
  stage: string,
  stageData?: StageStatus,
): string {
  const label = stageLabels[stage] || stage;
  const state = stageData?.state || "pending";
  const elapsed = stageData?.elapsed;
  const error = stageData?.error;

  let tooltip = `${label} (${state})`;
  if (elapsed) {
    tooltip += ` - ${formatElapsed(new Date(Date.now() - elapsed * 1000))}`;
  }
  if (error) {
    tooltip += `\nError: ${error}`;
  }
  return tooltip;
}

/**
 * Generate tooltip for stage progress bar in status banner
 * Shows stage info relative to current progress
 */
export function getStageProgressTooltip(
  stage: string,
  stageIndex: number,
  currentStageIndex: number,
  pipelineState?: string,
): string {
  const label = stageLabels[stage] || stage;
  const isCompleted = currentStageIndex > stageIndex;
  const isCurrent = currentStageIndex === stageIndex;
  const isPaused = isCurrent && pipelineState === "paused";

  let status = isCompleted
    ? "✓ Completed"
    : currentStageIndex < stageIndex
      ? "○ Pending"
      : "● In Progress";
  if (isPaused) status = "⏸ Paused";

  return `${label}: ${status}`;
}

// ══════════════════════════════════════════════════════
// PIPELINE DISPLAY STATE — single source of truth for
// what MiniPipelineProgress and TaskList should render
// ══════════════════════════════════════════════════════

/**
 * Discriminated union describing exactly what to render for a task's pipeline progress.
 * Centralises all branching so both inline and bar variants render identically.
 */
export type PipelineDisplayState =
  | {
      kind: "stage-progress";
      /** 0-based index in ALL_STAGES of the current running stage */
      stageIndex: number;
      /** Human-readable label, e.g. "Building" */
      label: string;
      /** 1-based step number */
      stepNumber: number;
      /** Total stages count */
      totalStages: number;
    }
  | {
      kind: "gate-paused";
      /** 0-based index of the stage the pipeline is paused at */
      stageIndex: number;
      /** Gate type when known */
      gateType?: "hard-stop" | "risk-gated";
      /** Stage label at pause point */
      label: string;
    }
  | {
      /** Pipeline has started but currentStage not yet written — show shimmer */
      kind: "starting";
    }
  | {
      /** No pipeline data — workflow run status is the best we have */
      kind: "no-data";
      workflowStatus?: "queued" | "in_progress" | "completed" | string;
    };

/**
 * Derive the single canonical display state for a task's progress.
 *
 * Priority order:
 * 1. pipeline.state === 'paused'  → gate-paused
 * 2. pipeline running + currentStage → stage-progress
 * 3. pipeline running, no currentStage → starting (just kicked off)
 * 4. No pipeline → no-data (use workflow run status as fallback text)
 */
export function derivePipelineDisplayState(
  task: KodyTask,
): PipelineDisplayState {
  const pipeline = task.pipeline;
  const gateType = task.gateType;

  // Case 1: Pipeline is paused at a gate (regardless of task.column — may lag)
  if (pipeline?.state === "paused") {
    // Find the highest completed/running stage as the pause point
    let pauseIdx = -1;
    for (const [stageName, stageData] of Object.entries(
      pipeline.stages || {},
    )) {
      if (stageData.state !== "pending") {
        const idx = ALL_STAGES.indexOf(
          stageName as (typeof ALL_STAGES)[number],
        );
        if (idx > pauseIdx) pauseIdx = idx;
      }
    }
    // currentStage is more reliable if set
    if (pipeline.currentStage) {
      const idx = ALL_STAGES.indexOf(
        pipeline.currentStage as (typeof ALL_STAGES)[number],
      );
      if (idx >= 0) pauseIdx = idx;
    }
    const label =
      pauseIdx >= 0
        ? stageLabels[ALL_STAGES[pauseIdx]] || ALL_STAGES[pauseIdx]
        : "Approval";
    return { kind: "gate-paused", stageIndex: pauseIdx, gateType, label };
  }

  // Case 2: Pipeline running with a known current stage.
  // currentStage may be an engine stage not in ALL_STAGES (e.g. `gsd-execute`,
  // `spec`, `test`, `ship`). Compute step N relative to the engine's actual
  // tracked stages so the label matches reality even for unknown stages.
  if (pipeline?.state === "running" && pipeline.currentStage) {
    const engineStages = pipeline.stages ? Object.keys(pipeline.stages) : [];
    const allStagesIdx = ALL_STAGES.indexOf(
      pipeline.currentStage as (typeof ALL_STAGES)[number],
    );
    const engineIdx = engineStages.indexOf(pipeline.currentStage);
    // Prefer ALL_STAGES index for known stages (so MiniPipelineProgress dots
    // light up correctly); fall back to the engine index for unknown stages.
    const stageIndex = allStagesIdx >= 0 ? allStagesIdx : engineIdx;
    const label = stageLabels[pipeline.currentStage] || pipeline.currentStage;
    const totalStages = ALL_STAGES.length;
    const stepNumber =
      engineIdx >= 0 ? engineIdx + 1 : allStagesIdx >= 0 ? allStagesIdx + 1 : 1;
    return {
      kind: "stage-progress",
      stageIndex,
      label,
      stepNumber,
      totalStages,
    };
  }

  // Case 3: Pipeline running but currentStage not yet set.
  // The kody engine often writes `cursor` instead of `currentStage`, and uses
  // a wider stage vocabulary than dashboard's ALL_STAGES. Walk engine stages
  // in execution order (insertion-ordered) so we find the real running stage.
  if (pipeline?.state === "running") {
    const engineStages = pipeline.stages ? Object.keys(pipeline.stages) : [];
    if (engineStages.length > 0) {
      let derivedStage: string | null = null;
      let lastCompleted: string | null = null;
      let derivedIndex = -1;
      let lastCompletedIndex = -1;
      engineStages.forEach((stage, i) => {
        const data = pipeline.stages[stage];
        if (!data) return;
        if (data.state === "completed" || data.state === "skipped") {
          lastCompleted = stage;
          lastCompletedIndex = i;
          return;
        }
        if (derivedStage === null) {
          derivedStage = stage;
          derivedIndex = i;
        }
      });
      const resolvedStage = derivedStage || lastCompleted;
      const resolvedIndex = derivedStage ? derivedIndex : lastCompletedIndex;
      if (resolvedStage) {
        // Prefer engine-relative index (1-based step) so labels align with the
        // tracked-stages count used by the bar. Fall back to ALL_STAGES index
        // for known stages so dot indicators in MiniPipelineProgress still light up.
        const allStagesIdx = ALL_STAGES.indexOf(
          resolvedStage as (typeof ALL_STAGES)[number],
        );
        const stageIndex = allStagesIdx >= 0 ? allStagesIdx : resolvedIndex;
        const label = stageLabels[resolvedStage] || resolvedStage;
        const totalStages = ALL_STAGES.length;
        const stepNumber = resolvedIndex + 1;
        return {
          kind: "stage-progress",
          stageIndex,
          label,
          stepNumber,
          totalStages,
        };
      }
    }
    return { kind: "starting" };
  }

  // Case 4: No pipeline data — fall back to workflow run status
  return { kind: "no-data", workflowStatus: task.workflowRun?.status };
}

/**
 * Return a concise one-line sub-status description for a task in the task list.
 * Used to replace the ad-hoc inline status elements with a consistent format.
 *
 * Examples:
 *   "Building · 6/12"
 *   "Awaiting approval at Architecting"
 *   "Starting pipeline..."
 *   "Running"
 */
export function getTaskSubStatusText(task: KodyTask): string {
  const state = derivePipelineDisplayState(task);
  const total = ALL_STAGES.length;

  switch (state.kind) {
    case "stage-progress":
      return `${state.label} · ${state.stepNumber}/${total}`;
    case "gate-paused":
      return `Paused · ${state.label || "Approval"}`;
    case "starting":
      return "Starting pipeline...";
    case "no-data": {
      const wf = state.workflowStatus;
      if (wf === "queued") return "Queued...";
      if (wf === "in_progress") return "Running";
      return "Starting...";
    }
  }
}
