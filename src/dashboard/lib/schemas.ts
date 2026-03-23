import { z } from 'zod'

// Task ID format: YYMMDD-description (e.g., 260221-test)
const TASK_ID_REGEX = /^[0-9]{6}-[a-zA-Z0-9-]+$/

/**
 * Task ID schema - validates format like "260221-test"
 */
export const taskIdSchema = z
  .string()
  .regex(TASK_ID_REGEX, 'Invalid taskId format (e.g., 260221-test)')

/**
 * Schema for /api/kody/prs query params
 */
export const prsQuerySchema = z
  .object({
    taskId: taskIdSchema,
  })
  .strict()

/**
 * Schema for /api/kody/prs/files query params
 * prNumber must be a positive integer
 */
export const prFilesQuerySchema = z
  .object({
    prNumber: z
      .string()
      .regex(/^\d+$/, 'prNumber must be a numeric string')
      .transform(Number)
      .pipe(z.number().int().positive('prNumber must be a positive integer')),
  })
  .strict()

/**
 * Schema for /api/kody/workflows query params
 * status is optional, but if provided must be one of the allowed values
 */
export const workflowsQuerySchema = z
  .object({
    status: z.enum(['queued', 'in_progress', 'completed']).optional(),
  })
  .strict()

/**
 * Schema for /api/kody/pipeline/[taskId] path params
 */
export const pipelineParamsSchema = z
  .object({
    taskId: taskIdSchema,
  })
  .strict()
