/**
 * @fileoverview Engine Contract Barrel Export
 * @fileType contract
 * @domain kody
 * @pattern engine-contract
 * @ai-summary Exports all engine contract types, schemas, and utilities
 *
 * ## Contracts Overview
 *
 * ### Contract 1: Actions (Dashboard → Engine)
 * - `EngineAction` - Union type for all dashboard-to-engine actions
 * - `EngineActionSchema` - Zod schema for validation
 * - `isValidAction()` - State machine validation
 * - `parseActionFromComment()` - Parse @engine commands from comments
 * - `parseWorkflowDispatch()` - Parse workflow_dispatch inputs
 *
 * ### Contract 2: State (Engine → Dashboard)
 * - `PipelineStatus` - Generic pipeline status interface
 * - `PipelineStatusSchema` - Zod schema with `.passthrough()`
 * - `StageStatus` - Base stage status interface
 * - Label mapping functions (`isEngineLabel`, `getStateFromLabel`, `buildLabel`)
 * - Comment parsing functions (`findStatusCommentId`, `parseAndValidatePipelineStatus`)
 * - ETag polling helpers
 *
 * ### Kody Extension
 * - `KodyPipelineStatus` - Kody-specific status interface
 * - `KodyPipelineStatusSchema` - Kody Zod schema with extensions
 * - `KodyStageStatus` - Kody-specific stage status
 * - `ActorEvent` - Audit trail entry
 * - `translatePRReviewToAction()` - PR review → EngineAction adapter
 */

// ============ Actions Contract ============

export {
  EngineActionSchema,
  parseActionFromComment,
  parseWorkflowDispatch,
  isValidAction,
  getValidActions,
  getInvalidActions,
  describeAction,
  formatActionAsComment,
  type EngineAction,
  type PipelineState,
} from "./actions.js";

// ============ State Contract ============

export {
  StageStatusSchema,
  PipelineStatusSchema,
  buildStatusCommentMarker,
  parseStatusCommentMarker,
  extractPipelineData,
  buildStatusComment,
  findStatusCommentId,
  parseAndValidatePipelineStatus,
  isEngineLabel,
  getStateFromLabel,
  buildLabel,
  stateToKanbanColumn,
  LABEL_SUFFIX_TO_STATE,
  STATE_TO_LABEL_SUFFIX,
  getETag,
  buildPollingHeaders,
  isNotModifiedResponse,
  getCommentUpdateStrategy,
  type StageStatus,
  type PipelineStatus,
} from "./state.js";

// ============ Kody Extension ============

export {
  KodyStageStatusSchema,
  KodyPipelineStatusSchema,
  ActorEventSchema,
  translatePRReviewToAction,
  validateKodyStatusBackwardCompat,
  isKodyLabel,
  getKodyStateFromLabel,
  KODY_LABEL_PREFIX,
  KODY_LABEL_SUFFIXES,
  LEGACY_STAGE_FIELDS,
  type KodyStageStatus,
  type KodyPipelineStatus,
  type ActorEvent,
  type PRReviewEvent,
  type PRReviewPayload,
} from "./kody.js";
