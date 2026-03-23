/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern task-docs-api
 * @ai-summary API route to fetch task documents from the task's branch
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireKodyAuth } from '@dashboard/lib/auth'
import {
  findTaskBranch,
  findBranchByIssueNumber,
  fetchTaskDocuments,
  fetchBranchDocuments,
} from '@dashboard/lib/github-client'
import { TASK_ID_REGEX } from '@dashboard/lib/constants'

export async function GET(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError

  try {
    const { taskId } = await params
    const url = new URL(req.url)
    const branch = url.searchParams.get('branch')

    // If branch is provided (from PR), use it directly
    if (branch) {
      // If taskId matches internal format (YYMMDD-*), fetch directly
      if (TASK_ID_REGEX.test(taskId)) {
        const documents = await fetchTaskDocuments(taskId, branch)
        return NextResponse.json({ documents })
      }
      // Otherwise taskId is an issue number — discover the task dir on the branch
      const documents = await fetchBranchDocuments(branch)
      return NextResponse.json({ documents })
    }

    // No branch provided — try to discover it from the task ID
    if (TASK_ID_REGEX.test(taskId)) {
      // Internal task ID format (YYMMDD-*) — try known branch prefixes
      const discoveredBranch = await findTaskBranch(taskId)
      if (discoveredBranch) {
        const documents = await fetchTaskDocuments(taskId, discoveredBranch)
        return NextResponse.json({ documents })
      }
    } else {
      // Issue number — search for branch by issue number in branch name
      const discoveredBranch = await findBranchByIssueNumber(taskId)
      if (discoveredBranch) {
        const documents = await fetchBranchDocuments(discoveredBranch)
        return NextResponse.json({ documents })
      }
    }

    return NextResponse.json({ documents: [] })
  } catch (error) {
    console.error('[task-docs] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 })
  }
}
