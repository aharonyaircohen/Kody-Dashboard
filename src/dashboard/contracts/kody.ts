/**
 * @fileoverview Kody Pipeline Status Extension + PR Review Trigger Adapter
 * @fileType contract
 * @domain kody
 * @pattern engine-contract
 * @ai-summary Kody-specific extensions to the generic PipelineStatus contract
 *
 * ## KodyPipelineStatus Schema
 *
 * Kody extends the generic PipelineStatus with engine-specific fields:
 * - Cost tracking (totalCost, per-stage cost)
 * - Token usage tracking
 * - Control modes (auto, supervised, manual)
 * - Actor history audit trail
 * - Feedback loop metrics
 *
 * ## PR Review Trigger Adapter
 *
 * Translates GitHub PR `changes_requested` review events into
 * `{ action: 'rerun', feedback: reviewBody }` before dispatching
 * through the generic EngineAction contract.
 */

import { z } from "zod";
import { PipelineStatusSchema, StageStatusSchema } from "./state.js";

// ============ Kody Stage Status Schema ============

/**
 * Kody-specific stage status extensions.
 * These are preserved via Zod `.passthrough()` on the base PipelineStatus.
 */
export const KodyStageStatusSchema = StageStatusSchema.extend({
  /** Cost for this stage in USD */
  cost: z.number().nonnegative().optional(),
  /** Token usage for this stage */
  tokenUsage: z
    .object({
      input: z.number().int().nonnegative(),
      output: z.number().int().nonnegative(),
      cacheRead: z.number().int().nonnegative().optional(),
    })
    .optional(),
  /** Number of feedback loops initiated in this stage */
  feedbackLoops: z.number().int().nonnegative().optional(),
  /** Errors encountered during feedback loops */
  feedbackErrors: z.array(z.string()).optional(),
  /** Current fix attempt number */
  fixAttempt: z.number().int().nonnegative().optional(),
  /** Maximum fix attempts allowed */
  maxFixAttempts: z.number().int().positive().optional(),
  /** Issues found during review */
  issuesFound: z.number().int().nonnegative().optional(),
  /** Summary from review stage */
  reviewSummary: z.string().optional(),
  /** Session ID for this stage */
  sessionId: z.string().optional(),
});

export type KodyStageStatus = z.infer<typeof KodyStageStatusSchema>;

// ============ Kody Actor Event Schema ============

/**
 * A single entry in the pipeline actor audit trail.
 */
export const ActorEventSchema = z.object({
  /** Action type: pipeline-triggered, gate-approved, gate-rejected, stage-retried, etc. */
  action: z.string(),
  /** GitHub login of the person who performed the action */
  actor: z.string(),
  /** ISO timestamp */
  timestamp: z.string(),
  /** Stage name, if action is stage-specific */
  stage: z.string().optional(),
  /** Additional details about the action */
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ActorEvent = z.infer<typeof ActorEventSchema>;

// ============ Kody Pipeline Status Schema ============

/**
 * Kody-specific pipeline status extensions.
 * Extends the generic PipelineStatus with Kody-specific fields.
 *
 * Note: Uses `.passthrough()` to preserve any extra fields from the base
 * PipelineStatus schema while validating Kody-specific fields.
 */
export const KodyPipelineStatusSchema = z
  .object({
    // Base required fields (from PipelineStatus)
    taskId: z.string().min(1),
    state: z.enum(["running", "completed", "failed", "paused", "timeout"]),
    startedAt: z.string(),
    updatedAt: z.string(),
    completedAt: z.string().optional(),
    currentStage: z.string().nullable(),
    stages: z.record(z.string(), KodyStageStatusSchema),
    triggeredBy: z.string(),
    issueNumber: z.number().int().positive().optional(),
    runUrl: z.string().url().optional(),

    // Kody-specific fields
    /** Total cost in USD */
    totalCost: z.number().nonnegative().optional(),
    /** Control mode: auto (no gate), supervised (soft gate), manual (hard gate) */
    controlMode: z.enum(["auto", "supervised", "manual"]).optional(),
    /** Pipeline type: spec, impl, full */
    pipeline: z.string().optional(),
    /** Mode string (e.g., 'spec', 'impl', 'fix', 'rerun') */
    mode: z.string().optional(),
    /** Audit trail of actor actions */
    actorHistory: z.array(ActorEventSchema).optional(),
    /** Gate point name (e.g., 'taskify', 'architect') */
    gatePoint: z.string().optional(),
    /** GitHub login of the person who triggered this pipeline run */
    triggeredByLogin: z.string().optional(),
    /** GitHub login of the person who created the issue (the "owner") */
    issueCreator: z.string().optional(),
    /** Total elapsed time in seconds */
    totalElapsed: z.number().optional(),
    /** Run ID from the workflow */
    runId: z.string().optional(),
  })
  .passthrough();

export type KodyPipelineStatus = z.infer<typeof KodyPipelineStatusSchema>;

// ============ Backward Compatibility ============

/**
 * Legacy stage status fields that existed in the original Kody types.
 * These are now superseded by KodyStageStatusSchema.
 */
export const LEGACY_STAGE_FIELDS = {
  outputFile: z.string().optional(),
} as const;

// ============ PR Review Trigger Adapter ============

/**
 * GitHub PR review event types.
 */
export type PRReviewEvent =
  | "approved"
  | "changes_requested"
  | "commented"
  | "dismissed";

/**
 * GitHub PR review payload structure.
 */
export interface PRReviewPayload {
  action: PRReviewEvent;
  review: {
    id: number;
    body: string | null;
    commit_id: string;
    state: string;
    user: {
      login: string;
    };
  };
  pull_request: {
    id: number;
    number: number;
    title: string;
    body: string | null;
    state: string;
    html_url: string;
    base: {
      ref: string;
      sha: string;
    };
    head: {
      ref: string;
      sha: string;
    };
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
  };
}

/**
 * Translate a GitHub PR `changes_requested` review event into an EngineAction.
 *
 * This adapter lives above the generic EngineAction contract — it translates
 * GitHub-specific PR review events into the generic contract format.
 *
 * @param payload - GitHub PR review webhook payload
 * @returns EngineAction or null if translation is not applicable
 *
 * @example
 * translatePRReviewToAction(payload)
 * // => { action: 'rerun', feedback: 'Please fix the issues found...' }
 */
export function translatePRReviewToAction(
  payload: PRReviewPayload,
): { action: "rerun"; feedback: string } | null {
  // Only translate 'changes_requested' events
  if (payload.action !== "changes_requested") {
    return null;
  }

  // Require a review body with feedback
  const reviewBody = payload.review.body?.trim();
  if (!reviewBody) {
    return null;
  }

  // Return rerun action with the review feedback
  return {
    action: "rerun",
    feedback: reviewBody,
  };
}

// ============ Kody-Specific Label Convention ============

/**
 * Kody-specific label prefixes and suffixes.
 * Kody uses 'kody:' prefix instead of generic '{engine}:' pattern.
 */
export const KODY_LABEL_PREFIX = "kody:";

/**
 * All valid Kody label suffixes.
 */
export const KODY_LABEL_SUFFIXES = [
  "building",
  "done",
  "failed",
  "paused",
  "timeout",
  "gate-waiting",
  "retrying",
] as const;

/**
 * Check if a label is a valid Kody label.
 */
export function isKodyLabel(label: string): boolean {
  return new RegExp(`^kody:(${KODY_LABEL_SUFFIXES.join("|")})$`).test(label);
}

/**
 * Extract Kody state from a label.
 */
export function getKodyStateFromLabel(
  label: string,
): KodyPipelineStatus["state"] | null {
  if (!isKodyLabel(label)) return null;
  const suffix = label.replace("kody:", "");
  const stateMap: Record<string, KodyPipelineStatus["state"]> = {
    building: "running",
    done: "completed",
    failed: "failed",
    paused: "paused",
    timeout: "timeout",
  };
  return stateMap[suffix] ?? null;
}

// ============ Validation Helpers ============

/**
 * Validate that a status object passes both the generic PipelineStatus
 * and the Kody-specific KodyPipelineStatus schemas.
 *
 * Use this for backward compatibility verification — ensures existing
 * Kody Engine output passes the new contract schemas.
 *
 * @param status - Raw status object from Kody Engine
 * @returns Object with validation results for both schemas
 */
export function validateKodyStatusBackwardCompat(status: unknown): {
  isGenericValid: boolean;
  isKodyValid: boolean;
  genericError?: string;
  kodyError?: string;
} {
  const genericResult = PipelineStatusSchema.safeParse(status);
  const kodyResult = KodyPipelineStatusSchema.safeParse(status);

  return {
    isGenericValid: genericResult.success,
    isKodyValid: kodyResult.success,
    genericError: genericResult.success
      ? undefined
      : genericResult.error.message,
    kodyError: kodyResult.success ? undefined : kodyResult.error.message,
  };
}
