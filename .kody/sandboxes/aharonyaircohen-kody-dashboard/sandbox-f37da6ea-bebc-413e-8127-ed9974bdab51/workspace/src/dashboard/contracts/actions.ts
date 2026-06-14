/**
 * @fileoverview Engine Actions Contract — Dashboard → Engine communication
 * @fileType contract
 * @domain kody
 * @pattern engine-contract
 * @ai-summary Defines how the dashboard instructs the engine (run, approve, reject, rerun, abort)
 *
 * ## Contract 1: Actions (Dashboard → Engine)
 *
 * The 5 things a dashboard can tell an engine to do.
 * Trigger convention: `@{engine} {action} [args]` (comment) or `workflow_dispatch({ issue_number, command })`
 *
 * ## State Machine
 *
 * | State    | Valid actions           |
 * |----------|-------------------------|
 * | (none)   | run                     |
 * | running  | abort                   |
 * | paused   | approve, reject, abort   |
 * | failed   | rerun, run              |
 * | timeout  | rerun, run              |
 * | completed| rerun, run              |
 */

import { z } from "zod";

// ============ EngineAction Schema ============

/**
 * All possible actions the dashboard can dispatch to an engine.
 * Each action corresponds to a specific pipeline state transition.
 */
export const EngineActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("run"),
    /** Free-form command string — each engine parses its own syntax */
    command: z.string().min(1),
  }),
  z.object({
    action: z.literal("approve"),
  }),
  z.object({
    action: z.literal("reject"),
  }),
  z.object({
    action: z.literal("rerun"),
    /** Optional stage to resume from */
    fromStage: z.string().optional(),
    /** Optional feedback/context for the rerun */
    feedback: z.string().optional(),
  }),
  z.object({
    action: z.literal("abort"),
  }),
]);

export type EngineAction = z.infer<typeof EngineActionSchema>;

// ============ Pipeline States ============

export type PipelineState =
  | "running"
  | "completed"
  | "failed"
  | "paused"
  | "timeout";

// ============ State Machine ============

/**
 * Valid actions per pipeline state.
 * Enforces the state machine contract for action dispatching.
 */
const VALID_ACTIONS_BY_STATE: Record<
  PipelineState | "none",
  EngineAction["action"][]
> = {
  none: ["run"],
  running: ["abort"],
  paused: ["approve", "reject", "abort"],
  failed: ["rerun", "run"],
  timeout: ["rerun", "run"],
  completed: ["rerun", "run"],
};

/**
 * Check if an action is valid for the given pipeline state.
 *
 * @param state - Current pipeline state (or 'none' if no state exists)
 * @param action - The action to validate
 * @returns true if the action is valid for the current state
 */
export function isValidAction(
  state: PipelineState | "none",
  action: EngineAction,
): boolean {
  const validActions = VALID_ACTIONS_BY_STATE[state] ?? [];
  return validActions.includes(action.action);
}

/**
 * Get the set of valid actions for a given pipeline state.
 *
 * @param state - Current pipeline state (or 'none' if no state exists)
 * @returns Array of valid actions for the current state
 */
export function getValidActions(
  state: PipelineState | "none",
): EngineAction["action"][] {
  return VALID_ACTIONS_BY_STATE[state] ?? [];
}

/**
 * Get the invalid actions for a given pipeline state.
 *
 * @param state - Current pipeline state (or 'none' if no state exists)
 * @returns Array of invalid actions for the current state
 */
export function getInvalidActions(
  state: PipelineState | "none",
): EngineAction["action"][] {
  const allActions: EngineAction["action"][] = [
    "run",
    "approve",
    "reject",
    "rerun",
    "abort",
  ];
  const validActions = VALID_ACTIONS_BY_STATE[state] ?? [];
  return allActions.filter((a) => !validActions.includes(a));
}

// ============ Comment Parsing ============

/**
 * Parse a comment body to extract an EngineAction.
 * Matches the `@{engine} {action} [args]` convention.
 *
 * @param comment - The comment body to parse
 * @param engineName - The engine name to match (e.g., 'kody')
 * @returns Parsed EngineAction or null if no match
 *
 * @example
 * parseActionFromComment('@kody run --fresh', 'kody')
 * // => { action: 'run', command: '--fresh' }
 *
 * @example
 * parseActionFromComment('@kody rerun --fromStage implement', 'kody')
 * // => { action: 'rerun', fromStage: 'implement' }
 */
export function parseActionFromComment(
  comment: string,
  engineName: string,
): EngineAction | null {
  const trimmed = comment.trim();

  // Match @engineName action [args]
  // @engine run [command]
  const runMatch = trimmed.match(
    new RegExp(`^@${engineName}\\s+run(?:\\s+(.+))?$`, "i"),
  );
  if (runMatch) {
    return { action: "run", command: runMatch[1]?.trim() ?? "" };
  }

  // @engine approve
  if (new RegExp(`^@${engineName}\\s+approve$`, "i").test(trimmed)) {
    return { action: "approve" };
  }

  // @engine reject
  if (new RegExp(`^@${engineName}\\s+reject$`, "i").test(trimmed)) {
    return { action: "reject" };
  }

  // @engine rerun [--fromStage stage] [--feedback text]
  const rerunMatch = trimmed.match(
    new RegExp(`^@${engineName}\\s+rerun(?:\\s+(.+))?$`, "i"),
  );
  if (rerunMatch) {
    const args = rerunMatch[1]?.trim() ?? "";
    const fromStageMatch = args.match(/--fromStage\s+(\S+)/);
    const feedbackMatch = args.match(/--feedback\s+(.+)/);
    return {
      action: "rerun",
      fromStage: fromStageMatch?.[1],
      feedback: feedbackMatch?.[1]?.trim(),
    };
  }

  // @engine abort
  if (new RegExp(`^@${engineName}\\s+abort$`, "i").test(trimmed)) {
    return { action: "abort" };
  }

  return null;
}

/**
 * Parse workflow_dispatch inputs into an EngineAction.
 *
 * @param inputs - workflow_dispatch inputs containing issue_number and command
 * @returns Parsed EngineAction with action 'run' and the command
 *
 * @example
 * parseWorkflowDispatch({ issue_number: 42, command: 'impl --fresh' })
 * // => { action: 'run', command: 'impl --fresh' }
 */
export function parseWorkflowDispatch(inputs: {
  issue_number: number;
  command?: string;
}): EngineAction {
  return {
    action: "run",
    command: inputs.command ?? "",
  };
}

// ============ Action Display Helpers ============

/**
 * Human-readable description of an action.
 */
export function describeAction(action: EngineAction): string {
  if (action.action === "run") {
    return `Run: ${action.command || "(no command)"}`;
  }
  if (action.action === "approve") {
    return "Approve";
  }
  if (action.action === "reject") {
    return "Reject";
  }
  if (action.action === "rerun") {
    return action.fromStage ? `Rerun from ${action.fromStage}` : "Rerun";
  }
  if (action.action === "abort") {
    return "Abort";
  }
  // Exhaustive check - this should never be reached
  throw new Error(`Unknown action type: ${JSON.stringify(action)}`);
}

/**
 * Format an action as a GitHub comment.
 */
export function formatActionAsComment(
  action: EngineAction,
  engineName: string,
): string {
  if (action.action === "run") {
    return `@${engineName} run ${action.command}`;
  }
  if (action.action === "approve") {
    return `@${engineName} approve`;
  }
  if (action.action === "reject") {
    return `@${engineName} reject`;
  }
  if (action.action === "rerun") {
    let comment = `@${engineName} rerun`;
    if (action.fromStage) comment += ` --fromStage ${action.fromStage}`;
    if (action.feedback) comment += ` --feedback ${action.feedback}`;
    return comment;
  }
  if (action.action === "abort") {
    return `@${engineName} abort`;
  }
  // Exhaustive check - this should never be reached
  throw new Error(`Unknown action type: ${JSON.stringify(action)}`);
}
