/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern chat-save-api
 * @ai-summary API route to save chat history for a task to GitHub.
 *   Uses per-user GitHub token for file writes when available.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireKodyAuth, getUserOctokit } from '@dashboard/lib/auth'
import { findTaskBranch, findBranchByIssueNumber, getOctokit } from '@dashboard/lib/github-client'
import { GITHUB_OWNER, GITHUB_REPO, TASK_ID_REGEX } from '@dashboard/lib/constants'
import type { ChatHistory } from '@dashboard/lib/chat-types'

const saveChatSchema = z.object({
  taskId: z.string(),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      text: z.string(),
      timestamp: z.string().optional(),
    }),
  ),
})

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req)
  if (authError) return authError

  try {
    const body = await req.json()
    const validation = saveChatSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json({ error: validation.error.message }, { status: 400 })
    }

    const { taskId, messages } = validation.data

    // Find the branch for this task
    let branch: string | null = null

    if (TASK_ID_REGEX.test(taskId)) {
      branch = await findTaskBranch(taskId)
    } else {
      branch = await findBranchByIssueNumber(taskId)
    }

    if (!branch) {
      return NextResponse.json({ error: 'Task has no branch yet' }, { status: 400 })
    }

    // Use bot token for reads, user token for writes
    const readOctokit = getOctokit()
    const userOctokit = await getUserOctokit(req)
    const writeOctokit = userOctokit ?? readOctokit

    const filePath = `.tasks/${taskId}/chat.json`

    // Single fetch: get existing file content + SHA in one call (read — bot token)
    let sha: string | undefined
    let chatData: ChatHistory = { version: 1, taskId, sessions: [] }
    let existingContentBase64: string | undefined

    try {
      const { data } = await readOctokit.repos.getContent({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: filePath,
        ref: branch,
      })

      if ('content' in data) {
        sha = data.sha
        existingContentBase64 = data.content // Save for dedup check
        if (data.content) {
          const existingContent = Buffer.from(data.content, 'base64').toString('utf-8')
          chatData = JSON.parse(existingContent)
        }
      }
    } catch (error: unknown) {
      // File doesn't exist yet — that's fine, we'll create it
      const status = (error as { status?: number })?.status
      if (status !== 404) {
        console.error('[chat-save] Error getting existing file:', error)
      }
    }

    // If messages is empty, clear the dashboard sessions (user wants to clear chat)
    if (messages.length === 0) {
      chatData.sessions = chatData.sessions.filter((s) => s.stage !== 'dashboard')
    } else {
      // Find or create dashboard session
      let dashboardSession = chatData.sessions.find((s) => s.stage === 'dashboard')

      if (!dashboardSession) {
        dashboardSession = {
          stage: 'dashboard',
          startedAt: new Date().toISOString(),
          messages: [],
        }
        chatData.sessions.push(dashboardSession)
      }

      // Replace all dashboard messages with new ones
      dashboardSession.messages = messages.map((m) => ({
        role: m.role,
        text: m.text,
        timestamp: m.timestamp || new Date().toISOString(),
      }))
    }

    // Write the file (write — user token for attribution)
    const content = Buffer.from(JSON.stringify(chatData, null, 2)).toString('base64')

    // Skip commit if content is identical to existing (dedup)
    if (existingContentBase64 && content === existingContentBase64) {
      return NextResponse.json({ success: true, unchanged: true })
    }

    await writeOctokit.repos.createOrUpdateFileContents({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: filePath,
      message: `kody: update chat history for ${taskId}`,
      content,
      branch,
      sha,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[chat-save] Error:', error)
    return NextResponse.json({ error: 'Failed to save chat' }, { status: 500 })
  }
}
