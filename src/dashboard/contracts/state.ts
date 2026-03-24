/**
 * @fileoverview Engine State Contract — Engine → Dashboard communication
 * @fileType contract
 * @domain kody
 * @pattern engine-contract
 * @ai-summary Defines how the engine communicates state back to the dashboard (labels + status comment)
 *
 * ## Contract 2: State (Engine → Dashboard)
 *
 * Two channels for engine → dashboard communication:
 *
 * ### Channel A: Labels (quick state for kanban)
 * Format: `{engine}:{suffix}`
 * Engine swaps labels on every state transition
 *
 * ### Channel B: Status Comment (rich progress)
 * Marker format: `<!-- {engine}-status:{taskId} -->`
 * Contains JSON block with detailed pipeline progress
 *
 * ## Real-time Polling Strategy
 * - Pipeline running: poll every 3s with `If-None-Match` (ETag). 304 = no change.
 * - Pipeline idle/completed: poll every 30s or stop.
 */

import { z } from "zod";

// ============ Stage Status Schema ============

/**
 * Base stage status schema — engine-defined stage names,
 * dashboard reads them from the `stages` field and renders in insertion order.
 */
export const StageStatusSchema = z.object({
  state: z.enum([
    "pending",
    "running",
    "completed",
    "failed",
    "skipped",
    "paused",
    "timeout",
    "observing",
  ]),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  elapsed: z.number().optional(),
  retries: z.number().int().nonnegative().default(0),
  error: z.string().optional(),
});

export type StageStatus = z.infer<typeof StageStatusSchema>;

// ============ PipelineStatus Schema (Generic Base) ============

/**
 * Generic pipeline status schema — any engine must provide these fields.
 * Extra engine-specific fields are preserved via Zod `.passthrough()`.
 */
export const PipelineStatusSchema = z
  .object({
    taskId: z.string().min(1),
    state: z.enum(["running", "completed", "failed", "paused", "timeout"]),
    startedAt: z.string(),
    updatedAt: z.string(),
    completedAt: z.string().optional(),
    currentStage: z.string().nullable(),
    stages: z.record(z.string(), StageStatusSchema),
    triggeredBy: z.string(),
    issueNumber: z.number().int().positive().optional(),
    runUrl: z.string().url().optional(),
  })
  .passthrough();

export type PipelineStatus = z.infer<typeof PipelineStatusSchema>;

// ============ Label Mapping ============

/**
 * Label suffix → pipeline state mapping.
 * Format: `{engine}:{suffix}`
 */
export const LABEL_SUFFIX_TO_STATE: Record<string, PipelineStatus["state"]> = {
  building: "running",
  done: "completed",
  failed: "failed",
  paused: "paused",
  timeout: "timeout",
};

/**
 * Pipeline state → label suffix mapping.
 */
export const STATE_TO_LABEL_SUFFIX: Record<PipelineStatus["state"], string> = {
  running: "building",
  completed: "done",
  failed: "failed",
  paused: "paused",
  timeout: "timeout",
};

/**
 * Check if a label matches the engine label pattern `{engine}:{suffix}`.
 *
 * @param label - Full label name (e.g., 'kody:building')
 * @param engineName - Engine name to match (e.g., 'kody')
 * @returns true if label matches the pattern
 */
export function isEngineLabel(label: string, engineName: string): boolean {
  return new RegExp(
    `^${engineName}:(${Object.keys(LABEL_SUFFIX_TO_STATE).join("|")})$`,
  ).test(label);
}

/**
 * Extract the pipeline state from a label.
 *
 * @param label - Full label name (e.g., 'kody:building')
 * @param engineName - Engine name to match
 * @returns Pipeline state or null if not a valid engine label
 */
export function getStateFromLabel(
  label: string,
  engineName: string,
): PipelineStatus["state"] | null {
  const match = label.match(new RegExp(`^${engineName}:(.+)$`));
  if (!match) return null;
  return LABEL_SUFFIX_TO_STATE[match[1]] ?? null;
}

/**
 * Build a full label name from engine name and state.
 *
 * @param engineName - Engine name (e.g., 'kody')
 * @param state - Pipeline state
 * @returns Full label name (e.g., 'kody:building')
 */
export function buildLabel(
  engineName: string,
  state: PipelineStatus["state"],
): string {
  return `${engineName}:${STATE_TO_LABEL_SUFFIX[state]}`;
}

// ============ Kanban Column Mapping ============

/**
 * Maps pipeline state to kanban column IDs.
 */
export function stateToKanbanColumn(
  state: PipelineStatus["state"] | null,
): string {
  switch (state) {
    case "running":
      return "building";
    case "completed":
      return "done";
    case "failed":
      return "failed";
    case "paused":
      return "gate-waiting";
    case "timeout":
      return "failed";
    default:
      return "open";
  }
}

// ============ Status Comment Parsing ============

/**
 * Comment marker format: `<!-- {engine}-status:{taskId} -->`
 */
export function buildStatusCommentMarker(
  engineName: string,
  taskId: string,
): string {
  return `<!-- ${engineName}-status:${taskId} -->`;
}

/**
 * Regex to extract the engine name and taskId from a status comment marker.
 */
const STATUS_COMMENT_MARKER_REGEX = /<!--\s*(\w+)-status:([\w-]+)\s*-->/;

/**
 * Check if a comment body contains a status comment marker.
 *
 * @param body - Comment body
 * @returns Object with engineName and taskId if found, null otherwise
 */
export function parseStatusCommentMarker(
  body: string,
): { engineName: string; taskId: string } | null {
  const match = body.match(STATUS_COMMENT_MARKER_REGEX);
  if (!match) return null;
  return { engineName: match[1], taskId: match[2] };
}

/**
 * Regex to extract the pipeline-data JSON block from a comment body.
 * Format: `<!--pipeline-data\n{json}\n-->`
 */
const PIPELINE_DATA_BLOCK_REGEX = /<!--pipeline-data\n([\s\S]*?)-->/;

/**
 * Extract the JSON data block from a status comment.
 *
 * @param body - Comment body
 * @returns Parsed JSON object or null if not found
 */
export function extractPipelineData(
  body: string,
): Record<string, unknown> | null {
  const match = body.match(PIPELINE_DATA_BLOCK_REGEX);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Build a status comment body with marker and data.
 *
 * @param engineName - Engine name
 * @param taskId - Task ID
 * @param status - Pipeline status object
 * @param humanReadableSummary - Human-readable progress summary (markdown)
 * @returns Complete comment body
 */
export function buildStatusComment(
  engineName: string,
  taskId: string,
  status: PipelineStatus,
  humanReadableSummary: string,
): string {
  const marker = buildStatusCommentMarker(engineName, taskId);
  const dataBlock = JSON.stringify(status, null, 2);
  return `${marker}

${humanReadableSummary}

<!--pipeline-data
${dataBlock}
-->`;
}

// ============ Status Comment Discovery & Caching ============

/**
 * Scan comments to find a status comment by marker.
 *
 * @param comments - Array of GitHub comments (with id, body, created_at, user)
 * @param engineName - Engine name
 * @param taskId - Task ID
 * @returns Comment ID if found, null otherwise
 */
export function findStatusCommentId(
  comments: Array<{ id: number; body: string }>,
  engineName: string,
  taskId: string,
): number | null {
  const marker = buildStatusCommentMarker(engineName, taskId);
  const comment = comments.find((c) => c.body.includes(marker));
  return comment?.id ?? null;
}

/**
 * Parse and validate pipeline data from a comment body.
 *
 * @param body - Comment body
 * @returns Validated PipelineStatus or null if invalid
 */
export function parseAndValidatePipelineStatus(
  body: string,
): PipelineStatus | null {
  const data = extractPipelineData(body);
  if (!data) return null;

  const result = PipelineStatusSchema.safeParse(data);
  if (!result.success) return null;

  return result.data;
}

// ============ ETag Polling Helpers ============

/**
 * Parse ETag from response headers.
 */
export function getETag(response: Response): string | null {
  return response.headers.get("ETag");
}

/**
 * Build conditional request headers for polling.
 */
export function buildPollingHeaders(
  etag?: string | null,
): Record<string, string> {
  if (etag) {
    return { "If-None-Match": etag };
  }
  return {};
}

/**
 * Check if response is a 304 Not Modified.
 */
export function isNotModifiedResponse(response: Response): boolean {
  return response.status === 304;
}

// ============ Comment Update Strategy ============

/**
 * Determine whether to create or update a status comment.
 *
 * @param existingCommentId - Existing comment ID (from cache), or null if not cached
 * @param comments - Current comments on the issue (for discovery scan)
 * @param engineName - Engine name
 * @param taskId - Task ID
 * @returns 'create' | 'update' | null
 */
export function getCommentUpdateStrategy(
  existingCommentId: number | null,
  comments: Array<{ id: number; body: string }>,
  engineName: string,
  taskId: string,
): "create" | "update" | null {
  // If we have a cached ID, try to use it
  if (existingCommentId) {
    const commentExists = comments.some((c) => c.id === existingCommentId);
    if (commentExists) return "update";
  }

  // Scan for existing marker
  const foundId = findStatusCommentId(comments, engineName, taskId);
  if (foundId) return "update";

  // No existing comment found
  return "create";
}
