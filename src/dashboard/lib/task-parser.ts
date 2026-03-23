/**
 * @fileType utility
 * @domain kody
 * @pattern task-parser
 * @ai-summary Parse GitHub bot comments to extract Kody task status
 */
import type { ParsedComment, CommentType, StageProgress, StageState } from './types'

// ============ Regex Patterns ============

const TASK_MARKER = /Task created: `([0-9]{6}-[a-zA-Z0-9-]+)`/
const RUNNING_STATUS = /🔄 Kody running for `([0-9]{6}-[a-zA-Z0-9-]+)`/
const SUCCESS = /✅ Kody completed for `([0-9]{6}-[a-zA-Z0-9-]+)`/
const FAILURE_CATCH = /❌ Pipeline failed for `([^`]+)`:\s*(.+)$/s
const FAILURE_STATUS = /❌ Kody failed for `([0-9]{6}-[a-zA-Z0-9-]+)`/
const TIMEOUT = /⏰ Kody timed out for `([0-9]{6}-[a-zA-Z0-9-]+)`/
const HARD_STOP = /## 🚫 Hard Stop/
const RISK_GATE = /## 🚦 Risk Gate/
const CLARIFY_STOP = /stopped at clarify stage/
const SUPERVISOR_RETRY = /\[supervisor-retry:\s*(\d+)\/(\d+)\]/
const SUPERVISOR_EXHAUSTED = /Max Retries Exhausted/
const SUPERVISOR_ERROR = /## Supervisor Error/
// Match both /kody and @kody prefixes for approval/rejection commands
const GATE_APPROVE = /^[\/@]kody\s+approve/
const GATE_REJECT = /^[\/@]kody\s+reject/
const VERCEL_PREVIEW = /\[Visit Preview\]\((https:\/\/[^)]+)\)/

// ============ Helper Functions ============

function extractTaskId(pattern: RegExp, body: string): string | undefined {
  const match = body.match(pattern)
  return match?.[1]
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getStageIcon(_state: StageState): string {
  const icons: Record<StageState, string> = {
    completed: '✅',
    failed: '❌',
    running: '🔄',
    pending: '⏳',
    skipped: '⚪',
    'gate-waiting': '🚫',
    paused: '⏸️',
    timeout: '⏰',
  }
  return icons[_state] || '⚪'
}

// ============ Stage Progress Parsing ============

function parseStageProgress(body: string): StageProgress[] {
  const stages: StageProgress[] = []

  // Match patterns like: ✅ taskify ✅ spec 🔄 architect ⏳ build
  const stagePattern = /([✅❌🔄⏳⚪])\s+(\w+)/g
  let match

  while ((match = stagePattern.exec(body)) !== null) {
    const icon = match[1]
    const stage = match[2]

    let state: StageState
    switch (icon) {
      case '✅':
        state = 'completed'
        break
      case '❌':
        state = 'failed'
        break
      case '🔄':
        state = 'running'
        break
      case '⏳':
        state = 'pending'
        break
      default:
        state = 'skipped'
    }

    stages.push({ stage, state, icon })
  }

  return stages
}

// ============ Main Parser ============

/**
 * Parse a single GitHub comment and extract Kody status information
 */
export function parseComment(comment: { body: string; created_at: string }): ParsedComment | null {
  const { body, created_at } = comment

  // Task marker: 🎯 Task created: `260219-auto-98` (`full` mode)
  if (TASK_MARKER.test(body)) {
    const taskId = extractTaskId(TASK_MARKER, body)
    const modeMatch = body.match(/\(`(\w+)`\s*mode\)/)
    return {
      type: 'task-marker',
      taskId,
      createdAt: created_at,
      body,
      mode: modeMatch?.[1],
    }
  }

  // Running status: 🔄 Kody running for `260219-auto-98`
  if (RUNNING_STATUS.test(body)) {
    const taskId = extractTaskId(RUNNING_STATUS, body)
    return {
      type: 'running-status',
      taskId,
      createdAt: created_at,
      body,
      stages: parseStageProgress(body),
    }
  }

  // Success: ✅ Kody completed for `260219-auto-98`!
  if (SUCCESS.test(body)) {
    const taskId = extractTaskId(SUCCESS, body)
    return {
      type: 'success',
      taskId,
      createdAt: created_at,
      body,
    }
  }

  // Failure (catch block): ❌ Pipeline failed for `260219-auto-98`: Stage "build" failed
  if (FAILURE_CATCH.test(body)) {
    const match = body.match(FAILURE_CATCH)
    return {
      type: 'failure',
      taskId: match?.[1],
      createdAt: created_at,
      body,
      error: match?.[2],
    }
  }

  // Failure (status): ❌ Kody failed for `260219-auto-98`
  if (FAILURE_STATUS.test(body)) {
    const taskId = extractTaskId(FAILURE_STATUS, body)
    return {
      type: 'kody-failed',
      taskId,
      createdAt: created_at,
      body,
    }
  }

  // Timeout: ⏰ Kody timed out for `260219-auto-98`
  if (TIMEOUT.test(body)) {
    const taskId = extractTaskId(TIMEOUT, body)
    return {
      type: 'timeout',
      taskId,
      createdAt: created_at,
      body,
    }
  }

  // Hard stop gate: ## 🚫 Hard Stop: Approval Required
  if (HARD_STOP.test(body)) {
    return {
      type: 'gate-request',
      createdAt: created_at,
      body,
    }
  }

  // Risk gate: ## 🚦 Risk Gate: Approval Required
  if (RISK_GATE.test(body)) {
    return {
      type: 'gate-request',
      createdAt: created_at,
      body,
    }
  }

  // Clarify stop: 🔄 Kody stopped at clarify stage
  if (CLARIFY_STOP.test(body)) {
    return {
      type: 'clarify-stop',
      createdAt: created_at,
      body,
    }
  }

  // Supervisor retry: [supervisor-retry: 2/3]
  if (SUPERVISOR_RETRY.test(body)) {
    const match = body.match(SUPERVISOR_RETRY)
    return {
      type: 'supervisor-retry',
      createdAt: created_at,
      body,
      retryNumber: match ? parseInt(match[1], 10) : undefined,
      maxRetries: match ? parseInt(match[2], 10) : undefined,
    }
  }

  // Supervisor exhausted: ## Supervisor: Max Retries Exhausted
  if (SUPERVISOR_EXHAUSTED.test(body)) {
    return {
      type: 'supervisor-exhausted',
      createdAt: created_at,
      body,
    }
  }

  // Supervisor error: ## Supervisor Error
  if (SUPERVISOR_ERROR.test(body)) {
    return {
      type: 'supervisor-error',
      createdAt: created_at,
      body,
    }
  }

  // Gate approval: /kody approve
  if (GATE_APPROVE.test(body.trim())) {
    return {
      type: 'gate-approval',
      createdAt: created_at,
      body,
    }
  }

  // Gate rejection: /kody reject
  if (GATE_REJECT.test(body.trim())) {
    return {
      type: 'gate-rejection',
      createdAt: created_at,
      body,
    }
  }

  // Vercel preview: [Visit Preview](https://...)
  if (VERCEL_PREVIEW.test(body)) {
    return {
      type: 'vercel-preview',
      createdAt: created_at,
      body,
    }
  }

  // Unknown comment
  return null
}

/**
 * Parse all comments and return sorted by date (oldest first)
 */
export function parseAllComments(
  comments: Array<{ body: string; created_at: string }>,
): ParsedComment[] {
  const parsed = comments
    .map(parseComment)
    .filter((c): c is ParsedComment => c !== null)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  return parsed
}

/**
 * Get the latest comment of a specific type
 */
export function getLatestByType(
  comments: ParsedComment[],
  type: CommentType,
): ParsedComment | null {
  const filtered = comments.filter((c) => c.type === type)
  return filtered.length > 0 ? filtered[filtered.length - 1] : null
}

/**
 * Get the latest comment of any failure type
 */
export function getLatestFailure(comments: ParsedComment[]): ParsedComment | null {
  const failureTypes: CommentType[] = ['failure', 'kody-failed', 'timeout']
  const filtered = comments.filter((c) => failureTypes.includes(c.type))
  return filtered.length > 0 ? filtered[filtered.length - 1] : null
}
