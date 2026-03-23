/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern chat-load-api
 * @ai-summary API route to load chat history for a task from GitHub
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireKodyAuth } from '@dashboard/lib/auth'
import { findTaskBranch, findBranchByIssueNumber, getOctokit } from '@dashboard/lib/github-client'
import { GITHUB_OWNER, GITHUB_REPO, TASK_ID_REGEX } from '@dashboard/lib/constants'

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError

  try {
    const url = new URL(req.url)
    const taskId = url.searchParams.get('taskId')

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 })
    }

    // Find the branch for this task
    let branch: string | null = null

    if (TASK_ID_REGEX.test(taskId)) {
      branch = await findTaskBranch(taskId)
    } else {
      branch = await findBranchByIssueNumber(taskId)
    }

    if (!branch) {
      return NextResponse.json({ sessions: [] })
    }

    const octokit = getOctokit()

    try {
      const { data } = await octokit.repos.getContent({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: `.tasks/${taskId}/chat.json`,
        ref: branch,
      })

      if ('content' in data && data.content) {
        const content = Buffer.from(data.content, 'base64').toString('utf-8')
        const chatData = JSON.parse(content)
        return NextResponse.json(chatData)
      }
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status
      if (status === 404) {
        return NextResponse.json({ sessions: [] })
      }
      console.error('[chat-load] Error fetching chat:', error)
    }

    return NextResponse.json({ sessions: [] })
  } catch (error) {
    console.error('[chat-load] Error:', error)
    return NextResponse.json({ error: 'Failed to load chat' }, { status: 500 })
  }
}
