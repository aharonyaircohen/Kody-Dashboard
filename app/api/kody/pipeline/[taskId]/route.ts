/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern pipeline-api
 * @ai-summary API route to fetch pipeline status for a task
 */
import { NextRequest, NextResponse } from 'next/server'

import { handleKodyApiError } from '@dashboard/lib/github-error-handler'
import { pipelineParamsSchema } from '@dashboard/lib/schemas'
import { apiValidationError } from '@dashboard/lib/api-responses'
import { requireKodyAuth } from '@dashboard/lib/auth'
import {
  findTaskBranch,
  findBranchByIssueNumber,
  getStatusFromBranch,
  findStatusOnBranch,
  getStatusFromArtifact,
  fetchWorkflowRuns,
} from '@dashboard/lib/github-client'
import { matchWorkflowRunToTask } from '@dashboard/lib/workflow-matching'

export async function GET(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  // Check auth
  const authResult = await requireKodyAuth(req)
  if (authResult instanceof NextResponse) return authResult

  // Validate path params
  const { taskId: rawTaskId } = await params
  const parsed = pipelineParamsSchema.safeParse({ taskId: rawTaskId })
  if (!parsed.success) {
    return apiValidationError(
      parsed.error.issues.map((e) => ({ path: e.path.join('.'), message: e.message })),
    )
  }
  const { taskId } = parsed.data

  try {
    // Try branch status first (for running tasks)
    const branch = await findTaskBranch(taskId)
    if (branch) {
      let status = await getStatusFromBranch(taskId, branch)
      // Fallback: discover task ID by scanning .tasks/ directory
      if (!status) {
        status = await findStatusOnBranch(branch)
      }
      if (status) {
        return NextResponse.json({
          status,
          source: 'branch',
        })
      }
    }

    // If taskId looks like an issue number, try finding branch by issue number
    if (/^\d+$/.test(taskId)) {
      const issueBranch = await findBranchByIssueNumber(parseInt(taskId))
      if (issueBranch) {
        const status = await findStatusOnBranch(issueBranch)
        if (status) {
          return NextResponse.json({
            status,
            source: 'branch',
          })
        }
      }
    }

    // Try artifact status (for completed tasks)
    const workflowRuns = await fetchWorkflowRuns({ perPage: 10 })
    const run = matchWorkflowRunToTask(workflowRuns, '', 0, taskId)

    if (run) {
      const status = await getStatusFromArtifact(taskId, run.id.toString())
      if (status) {
        return NextResponse.json({
          status,
          source: 'artifact',
        })
      }
    }

    // No status found
    return NextResponse.json({
      status: null,
      source: null,
    })
  } catch (error: unknown) {
    return handleKodyApiError(error, 'pipeline')
  }
}
