/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern ai-chat-streaming
 * @ai-summary Streaming AI chat endpoint with GitHub MCP tools for repo browsing
 */
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { streamText, tool, stepCountIs, type ToolSet } from 'ai'
import { z } from 'zod'
import { logger } from '@dashboard/lib/logger'
import { NextRequest, NextResponse } from 'next/server'
import { requireKodyAuth, verifyActorLogin } from '@dashboard/lib/auth'
import { getAgent, type ToolScope, type AgentId } from '@dashboard/lib/agents'
import { getMCPManager } from './mcp-manager'
import { browseUrlTool } from './tools/browse-url'
import {
  fetchIssue,
  fetchIssues,
  fetchComments,
  getStatusFromBranch,
  findTaskBranch,
  fetchWorkflowRuns,
  findAssociatedPR,
  getOctokit,
} from '@dashboard/lib/github-client'
import { GITHUB_OWNER, GITHUB_REPO } from '@dashboard/lib/constants'
import { isRemoteEnabled } from '@dashboard/lib/remote-config'
import { REMOTE_SYSTEM_PROMPT_EXTENSION } from '@dashboard/lib/agents'
import type {
  KodyTask,
  KodyPipelineStatus,
  GitHubPR,
  GitHubComment,
  WorkflowRun,
} from '@dashboard/lib/types'

// Use Node.js runtime
export const runtime = 'nodejs'

// Attachment from request
interface Attachment {
  name: string
  mimeType: string
  data: string // base64 data URL
}

// Custom tools for Kody pipeline-specific data (not available in GitHub MCP)
const customTools = {
  // List Kody tasks (issues with special labels)
  listKodyTasks: tool({
    description:
      'List Kody operations tasks from the dashboard. Use this to get an overview of all tasks and their status.',
    inputSchema: z.object({
      days: z.number().optional().describe('Number of days to look back (default: 30)'),
      status: z.string().optional().describe('Filter by status label'),
    }),
    execute: async ({ days = 30, status }) => {
      const since = new Date()
      since.setDate(since.getDate() - days)

      const issues = await fetchIssues({ since: since.toISOString(), perPage: 50 })

      let tasks = issues.map(
        (issue): Partial<KodyTask> => ({
          id: issue.number.toString(),
          issueNumber: issue.number,
          title: issue.title,
          state: issue.state as 'open' | 'closed',
          labels: issue.labels?.map((l: { name: string }) => l.name) || [],
        }),
      )

      // Filter by status if specified
      if (status) {
        const statusLower = status.toLowerCase()
        tasks = tasks.filter((t) => t.labels?.some((l) => l.toLowerCase().includes(statusLower)))
      }

      return {
        count: tasks.length,
        tasks: tasks.slice(0, 20).map((t) => ({
          issueNumber: t.issueNumber,
          title: t.title,
          state: t.state,
          labels: t.labels,
        })),
      }
    },
  }),

  // Get detailed info for a specific task
  getKodyTask: tool({
    description:
      'Get detailed information about a specific Kody task including its pipeline status.',
    inputSchema: z.object({
      taskId: z.string().describe('The task ID (e.g., "260221-test" or issue number)'),
    }),
    execute: async ({ taskId }) => {
      // Extract issue number from taskId
      const issueNumber = taskId.includes('-')
        ? parseInt(taskId.split('-')[1]) || parseInt(taskId)
        : parseInt(taskId)

      if (isNaN(issueNumber)) {
        return { error: 'Invalid task ID format' }
      }

      const issue = await fetchIssue(issueNumber)
      if (!issue) {
        return { error: 'Task not found' }
      }

      // Try to get pipeline status
      const branch = await findTaskBranch(taskId)
      let pipelineStatus: KodyPipelineStatus | null = null
      if (branch) {
        pipelineStatus = await getStatusFromBranch(taskId, branch)
      }

      // Get associated PR
      const pr: GitHubPR | null = await findAssociatedPR(taskId)

      // Get comments
      const comments: GitHubComment[] = await fetchComments(issueNumber)

      return {
        issueNumber: issue.number,
        title: issue.title,
        state: issue.state,
        body: issue.body,
        labels: issue.labels?.map((l: { name: string }) => l.name) || [],
        assignees: issue.assignees?.map((u: { login: string }) => u.login) || [],
        htmlUrl: issue.html_url,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        pipeline: pipelineStatus
          ? {
              taskId: pipelineStatus.taskId,
              state: pipelineStatus.state,
              currentStage: pipelineStatus.currentStage,
              stages: pipelineStatus.stages,
              startedAt: pipelineStatus.startedAt,
              updatedAt: pipelineStatus.updatedAt,
            }
          : null,
        pr: pr
          ? {
              number: pr.number,
              title: pr.title,
              state: pr.state,
              url: pr.html_url,
              mergedAt: pr.merged_at,
            }
          : null,
        commentsCount: comments.length,
        recentComments: comments.slice(0, 5).map((c) => ({
          body: c.body?.slice(0, 500),
          author: c.user?.login,
          createdAt: c.created_at,
        })),
      }
    },
  }),

  // Get pipeline status for a task
  getPipelineStatus: tool({
    description:
      'Get the pipeline/CI status for a specific Kody task. Shows stage-by-stage progress.',
    inputSchema: z.object({
      taskId: z.string().describe('The task ID'),
    }),
    execute: async ({ taskId }) => {
      const branch = await findTaskBranch(taskId)
      if (!branch) {
        return { error: 'Could not find branch for task', taskId }
      }

      const status = await getStatusFromBranch(taskId, branch)
      if (!status) {
        return { error: 'No pipeline status found', branch }
      }

      return {
        taskId,
        branch,
        state: status.state,
        currentStage: status.currentStage,
        stages: status.stages,
        startedAt: status.startedAt,
        updatedAt: status.updatedAt,
        completedAt: status.completedAt,
        totalElapsed: status.totalElapsed,
      }
    },
  }),

  // Get workflow runs
  getWorkflowRuns: tool({
    description: 'Get recent GitHub Actions workflow runs for the Kody pipeline.',
    inputSchema: z.object({
      status: z
        .string()
        .optional()
        .describe('Filter by status: completed, failure, in_progress, queued'),
      perPage: z.number().optional().describe('Number of runs to return (default: 10)'),
    }),
    execute: async ({ status, perPage = 10 }) => {
      const statusFilter =
        status === 'success'
          ? 'completed'
          : status === 'failure'
            ? 'completed'
            : (status as 'completed' | 'in_progress' | 'queued' | undefined)

      const runs: WorkflowRun[] = await fetchWorkflowRuns({
        perPage: perPage,
        status: statusFilter,
      })

      return {
        count: runs.length,
        runs: runs.map((r) => ({
          id: r.id,
          status: r.status,
          conclusion: r.conclusion,
          url: r.html_url,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      }
    },
  }),

  // Get associated PR for a task
  getTaskPR: tool({
    description: 'Get the pull request associated with a Kody task.',
    inputSchema: z.object({
      taskId: z.string().describe('The task ID'),
    }),
    execute: async ({ taskId }) => {
      const pr = await findAssociatedPR(taskId)
      if (!pr) {
        return { error: 'No PR found for this task', taskId }
      }

      return {
        number: pr.number,
        title: pr.title,
        state: pr.state,
        url: pr.html_url,
        headBranch: pr.head?.ref,
        mergedAt: pr.merged_at,
      }
    },
  }),

  // Web browsing tool - fetch and read any public web page
  browseUrl: browseUrlTool,
}

// ===========================================
// TOOL SCOPE FILTER
// ===========================================

/**
 * Filter tools based on the agent's toolScope configuration.
 * - 'all': MCP tools + all custom Kody tools
 * - 'mcp-only': MCP tools only (repo browsing)
 * - 'mcp-and-task-create': MCP tools + createTask custom tool
 */
function filterToolsByScope(
  scope: ToolScope,
  mcpTools: Record<string, unknown>,
  kodyTools: typeof customTools,
) {
  switch (scope) {
    case 'all':
      return { ...mcpTools, ...kodyTools }
    case 'mcp-only':
      return { ...mcpTools }
    case 'mcp-and-task-create': {
      // Include MCP tools + only createTask from custom tools (if it exists)
      const filtered = { ...mcpTools }
      if ('createTask' in kodyTools) {
        ;(filtered as Record<string, unknown>).createTask = kodyTools.createTask
      }
      return filtered
    }
    default:
      return { ...mcpTools, ...kodyTools }
  }
}

// ===========================================
// TASK CONTEXT BUILDER
// ===========================================

/**
 * Client-provided task data from the dashboard.
 */
interface ClientTaskData {
  issueNumber: number
  title: string
  body: string
  state: string
  labels: string[]
  column: string
  pipeline?: {
    state: string
    currentStage: string | null
    stages: Record<string, { state: string }>
  }
  taskDefinition?: {
    task_type: string
    risk_level: string
    primary_domain: string
    scope: string[]
  }
  associatedPR?: {
    number: number
    state: string
    html_url: string
  }
}

/**
 * Builds task context from client-provided data + branch files.
 * Uses client data when available to avoid redundant GitHub API calls.
 */
async function buildTaskContext(
  taskId: string,
  clientData?: ClientTaskData,
): Promise<string | null> {
  const octokit = getOctokit()
  const contextParts: string[] = []

  // Use client-provided data for issue/pipeline when available
  if (clientData) {
    contextParts.push(`## Current Task Context`)
    contextParts.push(`**Task:** #${clientData.issueNumber} - ${clientData.title}`)
    contextParts.push(`**Status:** ${clientData.state}`)
    contextParts.push(`**Column:** ${clientData.column}`)
    if (clientData.labels.length > 0) {
      contextParts.push(`**Labels:** ${clientData.labels.join(', ')}`)
    }

    // Include task body/description if available
    if (clientData.body) {
      const truncatedBody =
        clientData.body.length > 1000 ? clientData.body.slice(0, 1000) + '...' : clientData.body
      contextParts.push(`\n**Description:**\n${truncatedBody}`)
    }

    // Include task definition
    if (clientData.taskDefinition) {
      const td = clientData.taskDefinition
      contextParts.push(`\n**Task Definition:**`)
      contextParts.push(`- Type: ${td.task_type}`)
      contextParts.push(`- Risk: ${td.risk_level}`)
      contextParts.push(`- Domain: ${td.primary_domain}`)
      if (td.scope.length > 0) {
        contextParts.push(`- Scope: ${td.scope.join(', ')}`)
      }
    }

    // Include pipeline status
    if (clientData.pipeline) {
      contextParts.push(`\n**Pipeline:** ${clientData.pipeline.state}`)
      const completedStages = Object.entries(clientData.pipeline.stages || {})
        .filter(([, s]) => s.state === 'completed')
        .map(([name]) => name)
      if (completedStages.length > 0) {
        contextParts.push(`**Completed:** ${completedStages.join(' → ')}`)
      }
      if (clientData.pipeline.currentStage) {
        contextParts.push(`**Current:** ${clientData.pipeline.currentStage}`)
      }
    }

    // Include PR info
    if (clientData.associatedPR) {
      contextParts.push(
        `\n**PR:** [#${clientData.associatedPR.number}](${clientData.associatedPR.html_url}) (${clientData.associatedPR.state})`,
      )
    }
  }

  // Find branch for fetching additional files
  let branch: string | null = null
  try {
    branch = await findTaskBranch(taskId)
  } catch {
    // Continue without branch files
  }

  if (!branch) {
    return contextParts.length > 0 ? contextParts.join('\n\n') : null
  }

  // Get key files from the branch (only spec.md and plan.md - task.json is in taskDefinition)
  const keyFiles = ['spec.md', 'plan.md']
  for (const file of keyFiles) {
    try {
      const { data } = await octokit.repos.getContent({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: `.tasks/${taskId}/${file}`,
        ref: branch,
      })

      if ('content' in data && data.content) {
        const fileContent = Buffer.from(data.content, 'base64').toString('utf-8')
        const truncated =
          fileContent.length > 2000 ? fileContent.slice(0, 2000) + '...' : fileContent
        contextParts.push(`\n## ${file}\n\n\`\`\`\n${truncated}\n\`\`\`\n`)
      }
    } catch {
      // File doesn't exist
    }
  }

  return contextParts.length > 0 ? contextParts.join('\n\n') : null
}

// ===========================================
// MESSAGE BUILDER WITH ATTACHMENTS
// ===========================================

/**
 * Converts attachments to AI SDK message content format.
 * For images, uses the proper vision model format.
 * For other files, includes as text content.
 */
function processAttachments(attachments?: Attachment[]) {
  if (!attachments || attachments.length === 0) return []

  const contents: Array<{ type: string; [key: string]: unknown }> = []

  for (const attachment of attachments) {
    const { mimeType, data, name } = attachment

    // Check if it's an image
    if (mimeType.startsWith('image/')) {
      // For images, use AI SDK's image part format
      // The data URL format is: data:image/png;base64,xxxxx
      contents.push({
        type: 'image',
        image: data, // Can be URL or base64 data URL
      })
    } else {
      // For non-image files, try to extract text content
      // Data URL format: data:text/plain;base64,xxxxx
      try {
        const isDataUrl = data.startsWith('data:')
        let textContent = data

        if (isDataUrl) {
          // Extract base64 part and decode
          const base64Match = data.match(/^data:[^;]+;base64,(.+)$/)
          if (base64Match) {
            textContent = Buffer.from(base64Match[1], 'base64').toString('utf-8')
          }
        }

        // Truncate large text files
        const truncatedText =
          textContent.length > 5000
            ? textContent.slice(0, 5000) + '\n\n[... file truncated ...]'
            : textContent

        contents.push({
          type: 'text',
          text: `File: ${name} (${mimeType})\n\n${truncatedText}`,
        })
      } catch {
        // If we can't decode, just include the filename as a reference
        contents.push({
          type: 'text',
          text: `[File attachment: ${name} (${mimeType}) - content not available]`,
        })
      }
    }
  }

  return contents
}

// ===========================================
// REMOTE TOOLS BUILDER
// ===========================================

/**
 * Builds the four remote dev tools for users with a configured remote environment.
 * The tools proxy through /api/kody/remote/exec on the Vercel side.
 * This is only called when isRemoteEnabled(actorLogin) is true.
 */
function buildRemoteTools(actorLogin: string): ToolSet {
  const proxyAction = async (action: string, payload: Record<string, unknown>) => {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SERVER_URL || ''}/api/kody/remote/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actorLogin, action, payload }),
    })
    return res.json()
  }

  return {
    remoteExec: tool({
      description:
        'Execute a shell command on the remote Mac dev environment. Use for running build commands, tests, checking processes, etc.',
      inputSchema: z.object({
        command: z.string().describe('Shell command to execute'),
        cwd: z.string().optional().describe('Working directory (must be within allowed roots)'),
      }),
      execute: async ({ command, cwd }) => proxyAction('exec', { command, cwd }),
    }),

    remoteRead: tool({
      description: 'Read a file from the remote Mac dev environment.',
      inputSchema: z.object({
        path: z.string().describe('Absolute path to the file to read'),
      }),
      execute: async ({ path }) => proxyAction('read', { path }),
    }),

    remoteWrite: tool({
      description: 'Write content to a file on the remote Mac dev environment.',
      inputSchema: z.object({
        path: z.string().describe('Absolute path to the file to write'),
        content: z.string().describe('Content to write to the file'),
      }),
      execute: async ({ path, content }) => proxyAction('write', { path, content }),
    }),

    remoteLs: tool({
      description: 'List directory contents on the remote Mac dev environment.',
      inputSchema: z.object({
        path: z.string().describe('Absolute path to the directory to list'),
      }),
      execute: async ({ path }) => proxyAction('ls', { path }),
    }),
  } as ToolSet
}

// ===========================================
// API HANDLERS
// ===========================================

export async function GET(req: NextRequest) {
  try {
    // Check authentication using GitHub OAuth
    const authResult = await requireKodyAuth(req)
    if (authResult !== null) {
      return authResult // Return the 401 response
    }

    // Get MCP health status from manager
    const mcpManager = getMCPManager()
    const mcps = await mcpManager.getHealthStatus()
    const totalMcpTools = mcps.reduce((sum, m) => sum + m.toolCount, 0)

    return NextResponse.json({
      status: 'Chat endpoint ready',
      mcps,
      toolCount: totalMcpTools + Object.keys(customTools).length,
    })
  } catch (error) {
    logger.error({ err: error }, 'Chat GET error')
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID()

  try {
    // Validate environment
    const githubToken = process.env.GH_PAT || process.env.GITHUB_TOKEN
    const geminiApiKey = process.env.GEMINI_API_KEY

    if (!githubToken) {
      return NextResponse.json(
        { error: 'GitHub token is not configured (set GH_PAT or GITHUB_TOKEN)' },
        { status: 503 },
      )
    }

    if (!geminiApiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY is not configured' }, { status: 503 })
    }

    const body = await req.json()
    const { messages = [], taskId, taskData, agentId, attachments, actorLogin } = body

    // Authenticate and verify actorLogin matches session
    const authResult = await verifyActorLogin(req, actorLogin)
    if ('status' in authResult) {
      return authResult // Return the 401/403 response
    }

    const { identity } = authResult

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: 'Messages are required' }, { status: 400 })
    }

    // Get the agent config (defaults to dashboard-manager)
    const agent = getAgent(agentId || 'dashboard-manager')
    logger.info(
      {
        requestId,
        actorLogin: identity.login, // Use verified identity, not client-supplied
        messageCount: messages.length,
        taskId,
        agentId: agent.id,
        attachmentCount: attachments?.length || 0,
      },
      'Chat request received',
    )

    // Build system prompt with agent-specific prompt and optional task context
    let systemPrompt = agent.systemPrompt
    if (taskId) {
      try {
        const taskContext = await buildTaskContext(taskId, taskData)
        if (taskContext) {
          systemPrompt = `${taskContext}\n\n${agent.systemPrompt}`
        }
      } catch (err) {
        logger.warn({ err, taskId }, 'Failed to load task context')
      }
    }

    // Get MCP tools for this agent via the manager (handles timeout and graceful degradation)
    const mcpManager = getMCPManager()
    const mcpTools = await mcpManager.getTools(agent.id as AgentId)

    logger.info(
      { requestId, agentId: agent.id, mcpToolCount: Object.keys(mcpTools).length },
      'MCP tools loaded for agent',
    )

    // Get MCP system prompt extensions (e.g., Figma tool documentation)
    const mcpPromptExt = await mcpManager.getSystemPromptExtensions(agent.id as AgentId)
    if (mcpPromptExt) {
      systemPrompt = systemPrompt + mcpPromptExt
    }

    // Filter tools based on agent's toolScope
    let allTools = filterToolsByScope(agent.toolScope, mcpTools, customTools) as ToolSet

    // Inject remote tools if this user has a remote dev environment configured
    // Use verified identity.login instead of client-supplied actorLogin
    if (identity.login && isRemoteEnabled(identity.login)) {
      const remoteTools = buildRemoteTools(identity.login)
      allTools = { ...allTools, ...remoteTools }
      // Extend system prompt with remote tool instructions
      systemPrompt = systemPrompt + REMOTE_SYSTEM_PROMPT_EXTENSION
    }

    // Inject dynamic tool list into system prompt
    // This ensures the LLM knows exactly which tools it has available at runtime
    const toolNames = Object.keys(allTools)
    const toolInventory =
      `\n\n## Your Available Tools (${toolNames.length})\n\n` +
      toolNames.map((name) => `- ${name}`).join('\n') +
      `\n\nIMPORTANT: If a user asks you to do something and you don't have a tool for it, ` +
      `explicitly say which tool or capability would be needed. Never say "I cannot" without ` +
      `explaining what's missing. If the user shares a URL, use the browseUrl tool to read it.`
    systemPrompt = systemPrompt + toolInventory

    // Convert messages to AI SDK format, handling attachments
    const attachmentContents = processAttachments(attachments)
    const aiMessages = messages.map((msg: { role: string; content: string }, index: number) => {
      // For the last user message, include attachments
      if (index === messages.length - 1 && msg.role === 'user' && attachmentContents.length > 0) {
        return {
          role: msg.role as 'user',
          content: [{ type: 'text', text: msg.content }, ...attachmentContents] as Array<{
            type: string
            [key: string]: unknown
          }>,
        }
      }
      return {
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }
    })

    // Create Google provider with explicit GEMINI_API_KEY
    const googleProvider = createGoogleGenerativeAI({
      apiKey: process.env.GEMINI_API_KEY,
    })

    // Stream the response using AI SDK v6
    const result = streamText({
      model: googleProvider('gemini-3.1-pro-preview'),
      tools: allTools,
      system: systemPrompt,
      messages: aiMessages,
      stopWhen: stepCountIs(15),
    })

    // Return streaming response using v6 UI message stream
    return result.toUIMessageStreamResponse()
  } catch (error) {
    logger.error({ err: error, requestId }, 'Chat route error')
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
        requestId,
      },
      { status: 500 },
    )
  }
}
