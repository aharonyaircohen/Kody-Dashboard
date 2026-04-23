'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import {
  Globe,
  Paperclip,
  X,
  Image as ImageIcon,
  FileText,
  FileCode,
  MessageSquare,
  History,
} from 'lucide-react'
import { AGENT, AGENTS, type AgentId, type AgentConfig } from '../agents'

function buildAgentList(brainConfigured: boolean): Omit<AgentConfig, 'systemPrompt'>[] {
  return Object.values(AGENTS)
    .filter((a) => a.id !== 'brain' || brainConfigured)
    .map(({ id, name, description, icon, backend, capabilities }) => ({
      id,
      name,
      description,
      icon,
      backend,
      capabilities,
    }))
}
import { getStoredAuth, getStoredBrainConfig } from '../api'
import type { KodyTask } from '../types'

/** Build fetch headers including client auth when available */
function authHeaders(): Record<string, string> {
  const auth = getStoredAuth()
  return auth
    ? { 'x-kody-token': auth.token, 'x-kody-owner': auth.owner, 'x-kody-repo': auth.repo }
    : {}
}

/** Add per-user Brain config headers on Brain-path requests. */
function brainHeaders(): Record<string, string> {
  const b = getStoredBrainConfig()
  return b ? { 'x-brain-url': b.url, 'x-brain-key': b.apiKey } : {}
}
import type { ChatMessage, ChatSession } from '../chat-types'
import { ConfirmDialog } from './ConfirmDialog'
import { useRemoteStatus } from '../hooks/useRemoteStatus'
import { useVoiceChat } from '../hooks/useVoiceChat'
import { VoiceButton } from './VoiceButton'
import { VoiceChatOverlay } from './VoiceChatOverlay'
import { useChatSessions } from '../hooks/useChatSessions'
import { useKodyActionState } from '../hooks/useKodyActionState'
import { SessionSidebar } from './SessionSidebar'
import { TaskSessionHistory } from './TaskSessionHistory'
import { ToolCallList, ThinkingPanel } from './ToolCallCard'
import { MessageActions } from './MessageActions'

interface Message {
  role: 'user' | 'assistant'
  content: string
  isLoading?: boolean
  timestamp?: string
  toolCalls?: Array<{
    name: string
    arguments: Record<string, unknown>
    result?: unknown
    status: 'running' | 'success' | 'error'
    durationMs?: number
  }>
}

/**
 * Convert ChatMessage (from session storage) to Message (UI)
 */
function chatToMessage(chat: ChatMessage): Message {
  return {
    role: chat.role,
    content: chat.text,
    timestamp: chat.timestamp,
    toolCalls: chat.toolCalls,
    isLoading: chat.isLoading,
  }
}

/**
 * Convert Message (UI) to ChatMessage (for session storage)
 */
function messageToChat(msg: Message): ChatMessage {
  return {
    role: msg.role,
    text: msg.content,
    timestamp: msg.timestamp || new Date().toISOString(),
    toolCalls: msg.toolCalls,
    isLoading: msg.isLoading,
  }
}

interface ToolCall {
  name: string
  arguments: Record<string, unknown>
  result?: unknown
  status: 'running' | 'success' | 'error'
  startedAt?: number
  durationMs?: number
}

interface Attachment {
  id: string
  name: string
  type: string
  size: number
  data: string // base64
  mimeType: string
}

interface KodyChatProps {
  selectedTask?: KodyTask | null
  /** GitHub login of the current user — used for remote dev status */
  actorLogin?: string | null
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return <ImageIcon className="w-4 h-4" />
  if (
    mimeType.includes('javascript') ||
    mimeType.includes('typescript') ||
    mimeType.includes('json') ||
    mimeType.includes('html') ||
    mimeType.includes('css')
  ) {
    return <FileCode className="w-4 h-4" />
  }
  return <FileText className="w-4 h-4" />
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function TypingIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-1" role="status" aria-live="polite">
      <span className="flex gap-1" aria-hidden="true">
        <span
          className="w-2 h-2 rounded-full bg-primary/70 animate-bounce"
          style={{ animationDelay: '-0.3s' }}
        />
        <span
          className="w-2 h-2 rounded-full bg-primary/70 animate-bounce"
          style={{ animationDelay: '-0.15s' }}
        />
        <span className="w-2 h-2 rounded-full bg-primary/70 animate-bounce" />
      </span>
      <span className="text-xs text-muted-foreground">{label} is thinking…</span>
    </div>
  )
}

export function KodyChat({ selectedTask, actorLogin }: KodyChatProps) {
  // Task-scoped messages (loaded from / saved to API)
  const [taskMessages, setTaskMessages] = useState<Message[]>([])
  const [isLoadingTaskChat, setIsLoadingTaskChat] = useState(false)

  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(false)
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId>(AGENT.id)
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [brainConfigured, setBrainConfigured] = useState(false)
  const brainAbortRef = useRef<AbortController | null>(null)
  const currentAgent = AGENTS[selectedAgentId] ?? AGENT
  const agentList = buildAgentList(brainConfigured)

  // Read Brain config once on mount. When Brain credentials were provided at
  // login, Brain becomes the default selection; otherwise Gemini is the default.
  useEffect(() => {
    const configured = getStoredBrainConfig() !== null
    setBrainConfigured(configured)
    if (configured) {
      setSelectedAgentId('brain')
    }
  }, [])

  // If the user had Brain selected but then removed the config, fall back to Gemini.
  useEffect(() => {
    if (selectedAgentId === 'brain' && !brainConfigured) {
      setSelectedAgentId(AGENT.id)
    }
  }, [brainConfigured, selectedAgentId])
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [voiceMuted, setVoiceMuted] = useState(false)
  const [voiceOverlayOpen, setVoiceOverlayOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  // Remote dev status (only polls when actorLogin is provided)
  const { data: remoteStatus } = useRemoteStatus(actorLogin)

  // Session sidebar state (for session management feature)
  const [showSessionSidebar, setShowSessionSidebar] = useState(false)

  // Task session history (loaded from API)
  const [taskSessions, setTaskSessions] = useState<ChatSession[]>([])
  const [showTaskHistory, setShowTaskHistory] = useState(false)

  // Use session hook for global (non-task) chat
  const sessionHook = useChatSessions()

  // Poll action state — detects when Kody is waiting for instructions
  const { state: actionState, isWaiting: isKodyWaiting } = useKodyActionState(selectedTask?.id)

  // Determine if we're in task mode or global mode
  const isTaskMode = !!selectedTask

  // Current messages — from task or global history (via session hook)
  // Convert ChatMessage[] from session storage to Message[] for UI
  const messages: Message[] = isTaskMode ? taskMessages : sessionHook.messages.map(chatToMessage)

  // Set messages function - uses session hook in global mode
  const setMessages = useCallback(
    (updater: Message[] | ((prev: Message[]) => Message[])) => {
      if (isTaskMode) {
        // Task mode: update task messages directly
        setTaskMessages((prev) => (typeof updater === 'function' ? updater(prev) : updater))
      } else {
        // Global mode: convert Message[] to ChatMessage[] before storing
        sessionHook.setMessages((prevChat: ChatMessage[]) => {
          const newMessages =
            typeof updater === 'function' ? updater(prevChat.map(chatToMessage)) : updater
          return newMessages.map(messageToChat)
        })
      }
    },
    [isTaskMode, sessionHook],
  )

  // ─── SSE for chat streaming ────────────────────────────────────────────────

  const connectSSE = useCallback(
    (sessionId: string) => {
      // Close any existing connection
      eventSourceRef.current?.close()

      // EventSource cannot attach custom headers — we pass the same auth
      // triplet as query params so the stream route can resolve the target
      // repo + GitHub token the same way the other chat endpoints do.
      const auth = getStoredAuth()
      const params = new URLSearchParams({ taskId: sessionId })
      if (auth) {
        params.set('owner', auth.owner)
        params.set('repo', auth.repo)
        params.set('token', auth.token)
      }
      const url = `/api/kody/events/stream?${params.toString()}`
      const es = new EventSource(url)
      eventSourceRef.current = es

      es.onmessage = (event) => {
        if (!event.data) return
        try {
          const parsed = JSON.parse(event.data)
          switch (parsed.type) {
            case 'connected':
              break
            case 'chat.message': {
              const { role, content, timestamp } = parsed
              setMessages((prev) => [
                ...prev.filter((m) => !(m.role === 'assistant' && m.isLoading)),
                {
                  role: role === 'user' ? 'user' : 'assistant',
                  content: content ?? '',
                  timestamp: timestamp ?? new Date().toISOString(),
                  isLoading: false,
                },
              ])
              break
            }
            case 'chat.done':
              setLoading(false)
              es.close()
              break
            case 'chat.error': {
              setLoading(false)
              setMessages((prev) => {
                const filtered = prev.filter((m) => !(m.role === 'assistant' && m.isLoading))
                return [
                  ...filtered,
                  {
                    role: 'assistant',
                    content: `Error: ${parsed.error ?? 'Unknown error'}`,
                    isLoading: false,
                  },
                ]
              })
              es.close()
              break
            }
          }
        } catch {
          // skip malformed
        }
      }

      es.onerror = () => {
        setLoading(false)
        es.close()
      }
    },
    [setMessages],
  )

  // Open SSE when a task is selected
  useEffect(() => {
    if (selectedTask?.id) {
      connectSSE(selectedTask.id)
    }
    return () => {
      eventSourceRef.current?.close()
    }
  }, [selectedTask?.id, connectSSE])

  // Load task chat when task changes
  useEffect(() => {
    if (selectedTask) {
      // Load chat from API
      setIsLoadingTaskChat(true)
      fetch(`/api/kody/chat/load?taskId=${selectedTask.id}`)
        .then(async (res) => {
          if (!res.ok) return null
          const data = await res.json()
          return data as { sessions: ChatSession[] } | null
        })
        .then((data) => {
          if (data?.sessions) {
            // Store all sessions for TaskSessionHistory
            setTaskSessions(data.sessions)

            // Convert dashboard sessions to messages
            const dashboardSessions = data.sessions.filter((s) => s.stage === 'dashboard')
            const converted: Message[] = []
            for (const session of dashboardSessions) {
              for (const msg of session.messages) {
                converted.push({
                  role: msg.role,
                  content: msg.text,
                  timestamp: msg.timestamp,
                })
              }
            }
            setTaskMessages(converted)
          }
        })
        .catch(console.error)
        .finally(() => setIsLoadingTaskChat(false))
    } else {
      // Clear task messages when no task
      setTaskMessages([])
      setTaskSessions([])
    }
  }, [selectedTask?.id]) // eslint-disable-line react-hooks/exhaustive-deps -- intentional: only id needed, full object ref changes on every poll

  // Save task chat after each message exchange (debounced)
  const saveTaskChat = useCallback(async () => {
    if (!selectedTask || taskMessages.length === 0) return

    try {
      const messagesForApi: ChatMessage[] = taskMessages.map((m) => ({
        role: m.role,
        text: m.content,
        timestamp: m.timestamp || new Date().toISOString(),
      }))

      await fetch('/api/kody/chat/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          taskId: selectedTask.id,
          messages: messagesForApi,
        }),
      })
    } catch (err) {
      console.error('Failed to save chat:', err)
      // Non-fatal - don't bother user
    }
  }, [selectedTask, taskMessages])

  // Save after streaming completes — skip saves while loading to avoid race conditions
  useEffect(() => {
    if (isTaskMode && taskMessages.length > 0 && !loading) {
      const timer = setTimeout(saveTaskChat, 2000)
      return () => clearTimeout(timer)
    }
  }, [taskMessages, isTaskMode, loading, saveTaskChat])

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, loading, scrollToBottom])

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close()
    }
  }, [])

  const executeClearHistory = () => {
    // Clear active session when clearing history in non-task mode
    if (!isTaskMode) {
      sessionHook.clearActiveSession()
    }

    setMessages([])
    setToolCalls([])

    // If in task mode, also clear the saved chat
    if (isTaskMode && selectedTask) {
      fetch('/api/kody/chat/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          taskId: selectedTask.id,
          messages: [], // Clear by saving empty
        }),
      }).catch(console.error)
    }
  }

  // Handle file selection
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const MAX_SIZE = 5 * 1024 * 1024 // 5MB
    const newAttachments: Attachment[] = []

    for (const file of Array.from(files)) {
      if (file.size > MAX_SIZE) {
        alert(`File "${file.name}" is too large. Maximum size is 5MB.`)
        continue
      }

      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(file)
        })

        newAttachments.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          type: file.type,
          size: file.size,
          data: dataUrl,
          mimeType: file.type,
        })
      } catch (err) {
        console.error('Failed to read file:', err)
        alert(`Failed to read file "${file.name}"`)
      }
    }

    setAttachments((prev) => [...prev, ...newAttachments])

    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const sendText = useCallback(
    async (
      messageContent: string,
      currentAttachments: Attachment[] = [],
    ): Promise<string | null> => {
      if (!messageContent.trim() && currentAttachments.length === 0) return null

      let fullContent = messageContent
      if (currentAttachments.length > 0) {
        const attachmentDescriptions = currentAttachments
          .map((a) => {
            const sizeStr = formatFileSize(a.size)
            if (a.mimeType.startsWith('image/')) return `[Image: ${a.name} (${sizeStr})]\n${a.data}`
            return `[File: ${a.name} (${a.mimeType}, ${sizeStr})]\n${a.data}`
          })
          .join('\n\n')
        fullContent = attachmentDescriptions + (messageContent ? `\n\n${messageContent}` : '')
      }

      const timestamp = new Date().toISOString()

      // Build message list (current messages + the new user message)
      const allMessages = [
        ...messages.map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp ?? timestamp })),
        { role: 'user' as const, content: fullContent, timestamp },
      ]

      setMessages((prev) => [
        ...prev,
        { role: 'user', content: fullContent, timestamp },
      ])

      // Resolve the session id used downstream:
      //   • task mode → the selected task's id.
      //   • Brain + global → the persisted UI chat session id. Reusing it
      //     keeps Brain's memory continuous across turns (Brain's chat server
      //     scopes history by chatId) and avoids littering the repo with an
      //     auto-created GitHub issue per message.
      //   • Kody engine + global → auto-create a GitHub task as before.
      let sessionId: string
      if (selectedTask) {
        sessionId = selectedTask.id
      } else if (selectedAgentId === 'brain' || selectedAgentId === 'kody') {
        // Kody-direct has no server-side session; reuse the local chat
        // session id purely for local history/key continuity.
        sessionId = sessionHook.activeSession?.id || sessionHook.createSession()
      } else {
        // Auto-create a task for global chat
        try {
          const taskRes = await fetch('/api/kody/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({
              title: `Chat ${new Date().toLocaleDateString()}`,
              body: 'Auto-created task for global chat session',
              autoTrigger: false,
            }),
          })
          if (!taskRes.ok) throw new Error(`Task creation failed: ${taskRes.status}`)
          const taskData = (await taskRes.json()) as {
            success?: boolean
            issue?: { number?: number }
            task?: { id?: string }
            id?: string
          }
          // Current tasks API returns { success, issue: { number } }.
          // Older shapes ({ task: { id } } or { id }) kept as fallbacks.
          sessionId =
            (taskData.issue?.number != null ? String(taskData.issue.number) : undefined) ??
            taskData.task?.id ??
            taskData.id ??
            ''
          if (!sessionId) throw new Error('No taskId returned')
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Failed to create task'
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: `Error: ${errorMessage}`, isLoading: false },
          ])
          return null
        }
      }

      setLoading(true)
      setToolCalls([])

      // Placeholder assistant message — will be replaced by SSE events
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '', isLoading: true, timestamp: new Date().toISOString() },
      ])

      // ─── Brain backend: sync SSE stream directly from /api/kody/chat/brain ───
      if (selectedAgentId === 'brain') {
        brainAbortRef.current?.abort()
        const abort = new AbortController()
        brainAbortRef.current = abort

        // Scope chat memory per user + per task so every issue gets its own
        // Brain session. `sessionId` alone (a bare issue number) would collide
        // across users working on the same task.
        const userKey = actorLogin ?? 'anon'
        const brainChatId = selectedTask
          ? `${userKey}--task-${selectedTask.id}`
          : `${userKey}--global-${sessionId}`

        // When chatting about a specific task, pass a compact context blob so
        // Brain answers in the context of that issue. Brain's route injects it
        // server-side before forwarding to the Brain chat server.
        const taskContext = selectedTask
          ? {
              issueNumber: selectedTask.issueNumber,
              title: selectedTask.title,
              body: selectedTask.body,
              state: selectedTask.state,
              labels: selectedTask.labels,
              column: selectedTask.column,
              pipeline: selectedTask.pipeline
                ? {
                    state: selectedTask.pipeline.state,
                    currentStage: selectedTask.pipeline.currentStage,
                  }
                : undefined,
              associatedPR: selectedTask.associatedPR
                ? {
                    number: selectedTask.associatedPR.number,
                    state: selectedTask.associatedPR.state,
                    html_url: selectedTask.associatedPR.html_url,
                  }
                : undefined,
            }
          : undefined

        // For Brain we send the clean user text plus attachments as a separate
        // structured field so the Brain server can build a proper multimodal
        // prompt (text + image blocks) rather than treating data URLs as text.
        const brainAttachments = currentAttachments.map((a) => ({
          name: a.name,
          mimeType: a.mimeType,
          data: a.data,
        }))

        try {
          const res = await fetch('/api/kody/chat/brain', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...authHeaders(),
              ...brainHeaders(),
            },
            body: JSON.stringify({
              chatId: brainChatId,
              message: messageContent,
              ...(taskContext ? { taskContext } : {}),
              ...(brainAttachments.length > 0 ? { attachments: brainAttachments } : {}),
            }),
            signal: abort.signal,
          })
          if (!res.ok || !res.body) {
            const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
            throw new Error(errorData.error || `HTTP ${res.status}`)
          }

          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buf = ''
          let latestAssistantText = ''

          const applyEvent = (parsed: {
            type?: string
            role?: string
            content?: string
            timestamp?: string
            error?: string
            id?: string
            name?: string
            input?: Record<string, unknown>
          }) => {
            if (parsed.type === 'chat.message') {
              if (parsed.role !== 'user' && typeof parsed.content === 'string') {
                latestAssistantText = parsed.content
              }
              setMessages((prev) => {
                const copy = [...prev]
                const idx = copy.findIndex((m) => m.role === 'assistant' && m.isLoading)
                if (idx >= 0) {
                  // Preserve any toolCalls already attached to the in-flight
                  // message so the thinking panel doesn't flicker on each text
                  // delta.
                  copy[idx] = {
                    ...copy[idx],
                    role: (parsed.role === 'user' ? 'user' : 'assistant') as Message['role'],
                    content: parsed.content ?? '',
                    timestamp: parsed.timestamp ?? copy[idx].timestamp,
                    isLoading: true,
                  }
                } else {
                  copy.push({
                    role: (parsed.role === 'user' ? 'user' : 'assistant') as Message['role'],
                    content: parsed.content ?? '',
                    timestamp: parsed.timestamp ?? new Date().toISOString(),
                    isLoading: true,
                  })
                }
                return copy
              })
            } else if (parsed.type === 'chat.tool_use') {
              // Attach the tool call to the current in-flight assistant
              // message. If the text deltas haven't started yet, create a
              // placeholder loading bubble so the panel has somewhere to live.
              setMessages((prev) => {
                const copy = [...prev]
                let idx = copy.findIndex((m) => m.role === 'assistant' && m.isLoading)
                if (idx < 0) {
                  copy.push({
                    role: 'assistant',
                    content: '',
                    timestamp: parsed.timestamp ?? new Date().toISOString(),
                    isLoading: true,
                    toolCalls: [],
                  })
                  idx = copy.length - 1
                }
                const existing = copy[idx].toolCalls ?? []
                copy[idx] = {
                  ...copy[idx],
                  toolCalls: [
                    ...existing,
                    {
                      name: parsed.name ?? 'tool',
                      arguments: parsed.input ?? {},
                      status: 'success',
                    },
                  ],
                }
                return copy
              })
            } else if (parsed.type === 'chat.done') {
              setLoading(false)
              setMessages((prev) =>
                prev.map((m) => (m.isLoading ? { ...m, isLoading: false } : m)),
              )
            } else if (parsed.type === 'chat.error') {
              setLoading(false)
              setMessages((prev) => {
                const filtered = prev.filter((m) => !(m.role === 'assistant' && m.isLoading))
                return [
                  ...filtered,
                  {
                    role: 'assistant',
                    content: `Error: ${parsed.error ?? 'Unknown error'}`,
                    isLoading: false,
                  },
                ]
              })
            }
          }

          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buf += decoder.decode(value, { stream: true })
            const lastNewline = buf.lastIndexOf('\n')
            if (lastNewline === -1) continue
            const chunk = buf.slice(0, lastNewline + 1)
            buf = buf.slice(lastNewline + 1)
            for (const line of chunk.split('\n')) {
              if (!line.startsWith('data: ')) continue
              const raw = line.slice(6).trim()
              if (!raw) continue
              try {
                applyEvent(JSON.parse(raw))
              } catch {
                /* skip malformed */
              }
            }
          }
          setLoading(false)
          setMessages((prev) => prev.map((m) => (m.isLoading ? { ...m, isLoading: false } : m)))
          return latestAssistantText || null
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            setMessages((prev) => prev.slice(0, -1))
            return null
          }
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          setLoading(false)
          setMessages((prev) => {
            const filtered = prev.filter((m) => !(m.role === 'assistant' && m.isLoading))
            return [
              ...filtered,
              { role: 'assistant', content: `Error: ${errorMessage}`, isLoading: false },
            ]
          })
          return null
        }
      }

      // ─── Kody direct backend: in-process LLM stream, no Actions/Brain ───
      if (selectedAgentId === 'kody') {
        // Forward task context when the user is chatting about a specific
        // task — same shape Brain receives, so the server can anchor the
        // reply in the right issue/PR.
        const kodyTaskContext = selectedTask
          ? {
              issueNumber: selectedTask.issueNumber,
              title: selectedTask.title,
              body: selectedTask.body,
              state: selectedTask.state,
              labels: selectedTask.labels,
              column: selectedTask.column,
              pipeline: selectedTask.pipeline
                ? {
                    state: selectedTask.pipeline.state,
                    currentStage: selectedTask.pipeline.currentStage,
                  }
                : undefined,
              associatedPR: selectedTask.associatedPR
                ? {
                    number: selectedTask.associatedPR.number,
                    state: selectedTask.associatedPR.state,
                    html_url: selectedTask.associatedPR.html_url,
                  }
                : undefined,
            }
          : undefined

        try {
          const res = await fetch('/api/kody/chat/kody', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({
              messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
              task: kodyTaskContext,
            }),
          })

          if (!res.ok || !res.body) {
            const errText = await res.text().catch(() => '')
            throw new Error(errText || `HTTP ${res.status}`)
          }

          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let acc = ''

          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            acc += decoder.decode(value, { stream: true })
            const text = acc
            setMessages((prev) => {
              const copy = [...prev]
              const idx = copy.findIndex((m) => m.role === 'assistant' && m.isLoading)
              if (idx >= 0) {
                copy[idx] = { ...copy[idx], content: text, isLoading: true }
              }
              return copy
            })
          }

          // Terminal — mark not loading.
          setMessages((prev) => {
            const copy = [...prev]
            const idx = copy.findIndex((m) => m.role === 'assistant' && m.isLoading)
            if (idx >= 0) copy[idx] = { ...copy[idx], isLoading: false }
            return copy
          })
          setLoading(false)
          return null
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error'
          setLoading(false)
          setMessages((prev) => {
            const filtered = prev.filter((m) => !(m.role === 'assistant' && m.isLoading))
            return [
              ...filtered,
              { role: 'assistant', content: `Error: ${errorMessage}`, isLoading: false },
            ]
          })
          return null
        }
      }

      // ─── Kody engine backend: async via GH Actions workflow ───
      try {
        const triggerRes = await fetch('/api/kody/chat/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            taskId: sessionId,
            messages: allMessages,
            dashboardUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
          }),
        })

        if (!triggerRes.ok) {
          const errorData = await triggerRes.json()
          throw new Error(errorData.error || `HTTP ${triggerRes.status}`)
        }

        // For task chats a separate useEffect opens the SSE on
        // selectedTask.id; global chats (no task) would otherwise never
        // see the engine's reply because nothing watches the session id.
        // Open the stream here so both modes are covered.
        connectSSE(sessionId)
        return null
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          setMessages((prev) => prev.slice(0, -1))
          return null
        }
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        setLoading(false)
        setMessages((prev) => {
          const filtered = prev.filter((m) => !(m.role === 'assistant' && m.isLoading))
          return [
            ...filtered,
            { role: 'assistant', content: `Error: ${errorMessage}`, isLoading: false },
          ]
        })
        return null
      }
    },
    [selectedTask, setMessages, messages, selectedAgentId, actorLogin, sessionHook, connectSSE],
  )

  const sendMessage = async () => {
    if (!input.trim() && attachments.length === 0) return
    const userMessage = input.trim()
    setInput('')
    const currentAttachments = [...attachments]
    setAttachments([])

    // If Kody is waiting for instructions, route to the action instruction endpoint
    if (isKodyWaiting && selectedTask?.id) {
      try {
        await fetch('/api/kody/action/instruction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            runId: selectedTask.id,
            instruction: userMessage,
          }),
        })
        // Add a temporary "instruction sent" message to the chat
        setMessages((prev) => [
          ...prev,
          {
            role: 'user' as const,
            content: userMessage,
            timestamp: new Date().toISOString(),
          },
          {
            role: 'assistant' as const,
            content: `📬 Instruction sent to Kody — waiting for response...`,
            timestamp: new Date().toISOString(),
          },
        ])
      } catch (err) {
        console.error('Failed to send instruction:', err)
      }
      return
    }

    await sendText(userMessage, currentAttachments)
  }

  // ─── Voice chat integration ───

  const handleVoiceSend = useCallback(
    async (transcript: string) => {
      const response = await sendText(transcript)
      if (response) voiceChatRef.current?.onResponseComplete(response)
    },
    [sendText],
  )

  const voiceChat = useVoiceChat({ onSendMessage: handleVoiceSend })
  const voiceChatRef = useRef(voiceChat)
  useEffect(() => {
    voiceChatRef.current = voiceChat
  }, [voiceChat])

  const handleVoiceToggleMute = useCallback(() => {
    setVoiceMuted((prev) => {
      const next = !prev
      if (next) voiceChat.pauseConversation()
      else voiceChat.resumeConversation()
      return next
    })
  }, [voiceChat])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleStop = () => {
    eventSourceRef.current?.close()
    setLoading(false)
    setMessages((prev) => {
      const newMessages = [...prev]
      const lastMsg = newMessages[newMessages.length - 1]
      if (lastMsg?.role === 'assistant') {
        lastMsg.isLoading = false
      }
      return newMessages
    })
  }

  // Generate placeholder based on mode
  const placeholder = isKodyWaiting
    ? `Give Kody instructions...`
    : isTaskMode
    ? `Ask about task #${selectedTask?.issueNumber}...`
    : `Ask Kody...`

  const canSend = input.trim() || attachments.length > 0

  return (
    <div className="relative flex flex-col h-full border-l bg-background">
      {/* Session Sidebar */}
      {showSessionSidebar && !isTaskMode && (
        <SessionSidebar
          sessions={sessionHook.sessions}
          activeSessionId={sessionHook.activeSession?.id || null}
          onSwitchSession={sessionHook.switchSession}
          onCreateSession={sessionHook.createSession}
          onDeleteSession={sessionHook.deleteSession}
          onRenameSession={sessionHook.renameSession}
          onPinSession={sessionHook.pinSession}
          className="absolute left-0 top-0 bottom-0 w-72 z-50"
        />
      )}
      {/* Voice Chat Overlay */}
      {voiceOverlayOpen && (
        <VoiceChatOverlay
          state={voiceChat.state}
          currentTranscript={voiceChat.currentTranscript}
          turnCount={voiceChat.turnCount}
          error={voiceChat.error}
          messages={messages}
          agentName={currentAgent.name}
          onStop={() => {
            voiceChat.stopConversation()
            setVoiceOverlayOpen(false)
            setVoiceMuted(false)
          }}
          onInterrupt={() => {
            voiceChat.interruptConversation()
          }}
          onToggleMute={handleVoiceToggleMute}
          isMuted={voiceMuted}
        />
      )}
      {/* Header with context */}
      <div className="pl-4 pr-4 py-3 border-b bg-gradient-to-r from-muted/80 to-muted/40">
        <div className="flex items-center justify-between">
          {/* Left: agent picker */}
          <div className="relative flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAgentMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
              aria-haspopup="listbox"
              aria-expanded={agentMenuOpen}
              title={`Switch assistant (current: ${currentAgent.name})`}
            >
              <span className="text-xl" role="img" aria-label={currentAgent.name}>
                {currentAgent.icon}
              </span>
              <span className="font-semibold text-base">{currentAgent.name}</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {messages.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-primary/10 text-primary text-xs rounded-full">
                {messages.length}
              </span>
            )}
            {agentMenuOpen && (
              <ul
                role="listbox"
                className="absolute top-full left-0 mt-1 z-30 min-w-[260px] rounded-md border bg-popover shadow-md"
              >
                {agentList.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAgentId(a.id)
                        setAgentMenuOpen(false)
                      }}
                      className={`w-full text-left px-3 py-2 hover:bg-accent text-sm flex items-start gap-2 ${
                        a.id === selectedAgentId ? 'bg-accent/50' : ''
                      }`}
                      role="option"
                      aria-selected={a.id === selectedAgentId}
                    >
                      <span className="text-lg" aria-hidden="true">
                        {a.icon}
                      </span>
                      <span className="flex flex-col">
                        <span className="font-medium">{a.name}</span>
                        <span className="text-xs text-muted-foreground">{a.description}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Remote dev status indicator — only visible when configured */}
          {remoteStatus?.configured && (
            <div
              className="flex items-center gap-1 text-xs text-muted-foreground"
              title={remoteStatus.online ? 'Remote dev: online' : 'Remote dev: offline'}
            >
              <span
                className={`w-2 h-2 rounded-full ${remoteStatus.online ? 'bg-green-500' : 'bg-red-400'}`}
                aria-label={remoteStatus.online ? 'Remote dev online' : 'Remote dev offline'}
              />
              <span className="hidden sm:inline">{remoteStatus.online ? 'Remote' : 'Offline'}</span>
            </div>
          )}

          {/* Right: Action buttons (session sidebar, task history) */}
          <div className="flex items-center gap-1">
            {/* Session sidebar toggle (global mode only) */}
            {!isTaskMode && (
              <button
                onClick={() => setShowSessionSidebar(!showSessionSidebar)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-all ${
                  showSessionSidebar
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background border-transparent hover:border-border'
                }`}
                title="Conversations"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Chats</span>
              </button>
            )}

            {/* Task history toggle (task mode only) */}
            {isTaskMode && taskSessions.length > 0 && (
              <button
                onClick={() => setShowTaskHistory(!showTaskHistory)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-all ${
                  showTaskHistory
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background border-transparent hover:border-border'
                }`}
                title="Session History"
              >
                <History className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">History</span>
              </button>
            )}
          </div>
        </div>

        {/* Context bar: task or global */}
        <div className="mt-2">
          {isTaskMode && selectedTask ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="px-1.5 py-0.5 bg-primary text-primary-foreground rounded font-medium">
                #{selectedTask.issueNumber}
              </span>
              <span className="truncate text-muted-foreground">{selectedTask.title}</span>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Globe className="w-3 h-3" />
              Global chat — not tied to any task
            </div>
          )}
        </div>
      </div>

      {/* Kody waiting for instructions banner */}
      {isKodyWaiting && actionState && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-2 text-sm text-amber-800">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
          </span>
          <span className="font-medium">Kody is waiting for your instructions</span>
          {actionState.step && (
            <span className="text-amber-600">— paused at <code className="bg-amber-100 px-1 rounded">{actionState.step}</code></span>
          )}
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.length === 0 && !loading && !isLoadingTaskChat && (
          <div className="text-center text-muted-foreground text-base py-8">
            {isTaskMode ? (
              <>
                <p className="font-medium">Chat about this task</p>
                <p className="text-sm mt-1">Messages will be saved to the task</p>
              </>
            ) : (
              <>
                <p className="font-medium">Hi! I can help you with:</p>
                <ul className="mt-3 text-left text-sm space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-primary">•</span>
                    <span>Browse repository files and code</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary">•</span>
                    <span>Search code across the codebase</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary">•</span>
                    <span>List and explain tasks</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary">•</span>
                    <span>Show pipeline status and progress</span>
                  </li>
                </ul>
              </>
            )}
          </div>
        )}

        {isLoadingTaskChat && (
          <div className="text-center text-muted-foreground text-sm py-8">
            Loading conversation...
          </div>
        )}

        {/* Task session history (task mode) */}
        {isTaskMode && showTaskHistory && taskSessions.length > 0 && (
          <div className="mb-4">
            <TaskSessionHistory sessions={taskSessions} />
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`group flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} relative`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-base ${
                msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
              }`}
            >
              {/* Message Actions */}
              <MessageActions
                role={msg.role}
                content={msg.content}
                isLast={i === messages.length - 1}
                isLoading={!!msg.isLoading}
                hasToolCalls={!!msg.toolCalls && msg.toolCalls.length > 0}
                onCopy={() => msg.content}
                onRetry={
                  msg.role === 'assistant' && i === messages.length - 1
                    ? () => {
                        /* TODO: Implement retry */
                      }
                    : undefined
                }
                onEdit={
                  msg.role === 'user'
                    ? (content) => {
                        setMessages((prev) => {
                          const newMessages = [...prev]
                          newMessages[i] = { ...newMessages[i], content }
                          return newMessages
                        })
                      }
                    : undefined
                }
                onDelete={() => {
                  setMessages((prev) => prev.filter((_, idx) => idx !== i))
                }}
              />

              {msg.role === 'assistant' ? (
                <>
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <ThinkingPanel
                      toolCalls={msg.toolCalls}
                      isStreaming={!!msg.isLoading}
                    />
                  )}
                  {!msg.content && loading && i === messages.length - 1 ? (
                    <TypingIndicator label={currentAgent.name} />
                  ) : (
                    <div className="prose prose-base dark:prose-invert max-w-none">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  )}
                </>
              ) : (
                msg.content
              )}
              {loading &&
                i === messages.length - 1 &&
                msg.role === 'assistant' &&
                msg.content && (
                  <span className="inline-block ml-2 animate-pulse text-primary">●</span>
                )}
            </div>
          </div>
        ))}

        {/* Typing indicator shown before an assistant placeholder exists.
            Covers the Kody-engine first-byte window where the placeholder is
            only pushed once the first SSE event arrives. */}
        {loading && messages.length > 0 && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg px-3 py-2 bg-muted">
              <TypingIndicator label={currentAgent.name} />
            </div>
          </div>
        )}

        {/* Tool calls display - using ToolCallList component */}
        {toolCalls.length > 0 && (
          <div className="flex justify-start">
            <ToolCallList
              toolCalls={toolCalls.map((tc) => ({
                name: tc.name,
                arguments: tc.arguments,
                result: tc.result,
                status: tc.status,
                startedAt: tc.startedAt,
                durationMs: tc.durationMs,
              }))}
            />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="px-3 pb-2 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex items-center gap-1.5 px-2 py-1 bg-muted rounded-md text-xs"
            >
              {getFileIcon(attachment.mimeType)}
              <span className="max-w-[100px] truncate">{attachment.name}</span>
              <span className="text-muted-foreground">{formatFileSize(attachment.size)}</span>
              <button
                onClick={() => removeAttachment(attachment.id)}
                className="ml-1 hover:text-destructive"
                disabled={loading}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="p-3 border-t">
        <div className="flex gap-2 items-end">
          {/* Attachment button */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.txt,.md,.json,.js,.ts,.jsx,.tsx,.html,.css,.scss,.yaml,.yml,.sh"
            onChange={handleFileSelect}
            className="hidden"
            disabled={loading}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
            title="Attach files"
          >
            <Paperclip className="w-5 h-5" />
          </button>

          {/* Voice button */}
          <VoiceButton
            isActive={voiceOverlayOpen}
            isSupported={voiceChat.isSupported}
            onTap={() => {
              // Handle tap based on current voice state:
              // - If AI is speaking: interrupt and start listening (voice interrupt)
              // - If listening/processing: stop conversation
              // - If idle: start conversation
              if (voiceChat.state === 'speaking') {
                // Voice interrupt: cancel AI speech and start listening
                voiceChat.interruptConversation()
                setVoiceOverlayOpen(true)
                setVoiceMuted(false)
              } else if (voiceOverlayOpen) {
                // Already in voice mode - stop it
                voiceChat.stopConversation()
                setVoiceOverlayOpen(false)
                setVoiceMuted(false)
              } else {
                // Not in voice mode - start it
                voiceChat.startConversation()
                setVoiceOverlayOpen(true)
              }
            }}
            onLongPressStart={() => {
              voiceChat.startConversation()
              setVoiceOverlayOpen(true)
            }}
            onLongPressEnd={() => {
              /* let conversation handle it */
            }}
            disabled={loading}
          />
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              // Auto-expand height
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            className="flex-1 px-3 py-2 text-base rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none overflow-hidden"
            disabled={loading}
            style={{ height: 'auto' }}
          />
          {loading ? (
            <button
              onClick={handleStop}
              className="px-3 py-2 text-base bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={sendMessage}
              disabled={!canSend}
              className="px-3 py-2 text-base bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              Send
            </button>
          )}
        </div>
        {/* Clear history link */}
        {messages.length > 0 && !loading && (
          <button
            onClick={() => setShowClearConfirm(true)}
            className="mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear history
          </button>
        )}
      </div>

      <ConfirmDialog
        open={showClearConfirm}
        title="Clear history"
        description="Clear conversation history? This cannot be undone."
        confirmLabel="Clear"
        variant="destructive"
        onConfirm={executeClearHistory}
        onClose={() => setShowClearConfirm(false)}
      />
    </div>
  )
}
