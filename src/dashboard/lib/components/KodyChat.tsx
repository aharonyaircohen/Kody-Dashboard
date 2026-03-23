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
import { AGENTS, type AgentId } from '../agents'
import type { KodyTask } from '../types'
import type { ChatMessage, ChatSession } from '../chat-types'
import { ConfirmDialog } from './ConfirmDialog'
import { useRemoteStatus } from '../hooks/useRemoteStatus'
import { useVoiceChat } from '../hooks/useVoiceChat'
import { VoiceButton } from './VoiceButton'
import { VoiceChatOverlay } from './VoiceChatOverlay'
import { useChatSessions } from '../hooks/useChatSessions'
import { SessionSidebar } from './SessionSidebar'
import { TaskSessionHistory } from './TaskSessionHistory'
import { ToolCallList } from './ToolCallCard'
import { MessageActions } from './MessageActions'

const AGENT_LIST = Object.values(AGENTS).map(({ id, name, description, icon, capabilities }) => ({
  id,
  name,
  description,
  icon,
  capabilities,
}))

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

export function KodyChat({ selectedTask, actorLogin }: KodyChatProps) {
  // Task-scoped messages (loaded from / saved to API)
  const [taskMessages, setTaskMessages] = useState<Message[]>([])
  const [isLoadingTaskChat, setIsLoadingTaskChat] = useState(false)

  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(false)
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([])
  const [selectedAgent, setSelectedAgent] = useState<AgentId>('dashboard-manager')
  const [showAgentDropdown, setShowAgentDropdown] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [voiceMuted, setVoiceMuted] = useState(false)
  const [voiceOverlayOpen, setVoiceOverlayOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Remote dev status (only polls when actorLogin is provided)
  const { data: remoteStatus } = useRemoteStatus(actorLogin)

  // Session sidebar state (for session management feature)
  const [showSessionSidebar, setShowSessionSidebar] = useState(false)

  // Task session history (loaded from API)
  const [taskSessions, setTaskSessions] = useState<ChatSession[]>([])
  const [showTaskHistory, setShowTaskHistory] = useState(false)

  // Use session hook for global (non-task) chat
  const sessionHook = useChatSessions(selectedAgent)

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
        headers: { 'Content-Type': 'application/json' },
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

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowAgentDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  const currentAgent = AGENT_LIST.find((a) => a.id === selectedAgent) ?? AGENT_LIST[0]

  const handleAgentChange = (agentId: AgentId) => {
    if (agentId === selectedAgent) {
      setShowAgentDropdown(false)
      return
    }

    // Abort any in-flight request before switching
    if (loading) {
      abortControllerRef.current?.abort()
      setLoading(false)
    }

    if (voiceOverlayOpen) {
      voiceChat.stopConversation()
      setVoiceOverlayOpen(false)
      setVoiceMuted(false)
    }
    setSelectedAgent(agentId)
    setShowAgentDropdown(false)
    setToolCalls([])
  }

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
        headers: { 'Content-Type': 'application/json' },
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

      setMessages((prev) => [
        ...prev,
        { role: 'user', content: fullContent, timestamp: new Date().toISOString() },
      ])
      setLoading(true)
      setToolCalls([])
      abortControllerRef.current = new AbortController()
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '', isLoading: true, timestamp: new Date().toISOString() },
      ])

      let accumulatedContent = ''

      try {
        const requestBody: {
          agentId: AgentId
          messages: Array<{ role: 'user' | 'assistant'; content: string }>
          taskId?: string
          taskData?: {
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
            associatedPR?: { number: number; state: string; html_url: string }
          }
          attachments?: Array<{ name: string; mimeType: string; data: string }>
        } = {
          agentId: selectedAgent,
          messages: [
            ...messages.map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: fullContent },
          ],
        }

        if (currentAttachments.length > 0) {
          requestBody.attachments = currentAttachments.map((a) => ({
            name: a.name,
            mimeType: a.mimeType,
            data: a.data,
          }))
        }

        if (selectedTask) {
          requestBody.taskId = selectedTask.id
          requestBody.taskData = {
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
                  stages: selectedTask.pipeline.stages,
                }
              : undefined,
            taskDefinition: selectedTask.taskDefinition,
            associatedPR: selectedTask.associatedPR
              ? {
                  number: selectedTask.associatedPR.number,
                  state: selectedTask.associatedPR.state,
                  html_url: selectedTask.associatedPR.html_url,
                }
              : undefined,
          }
        }

        const response = await fetch('/api/kody/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: abortControllerRef.current.signal,
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || `HTTP ${response.status}`)
        }
        if (!response.body) throw new Error('No response body')

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        const parseSSEChunk = (text: string) => {
          const lines = text.split('\n')
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6)
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              switch (parsed.type) {
                case 'text-delta': {
                  accumulatedContent += parsed.delta
                  setMessages((prev) => {
                    const newMessages = [...prev]
                    const lastMsg = newMessages[newMessages.length - 1]
                    if (lastMsg?.role === 'assistant') lastMsg.content = accumulatedContent
                    return newMessages
                  })
                  break
                }
                case 'tool-input-start':
                  setToolCalls((prev) => [
                    ...prev,
                    {
                      name: parsed.toolName,
                      arguments: {},
                      status: 'running' as const,
                      startedAt: Date.now(),
                    },
                  ])
                  break
                case 'tool-output-available':
                  break
                case 'error':
                  console.error('Stream error:', parsed.errorText)
                  break
              }
            } catch {
              /* skip malformed JSON */
            }
          }
        }

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lastNewline = buffer.lastIndexOf('\n')
          if (lastNewline !== -1) {
            parseSSEChunk(buffer.slice(0, lastNewline + 1))
            buffer = buffer.slice(lastNewline + 1)
          }
        }
        if (buffer.trim()) parseSSEChunk(buffer)

        return accumulatedContent
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          setMessages((prev) => prev.slice(0, -1))
          return null
        }
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        setMessages((prev) => {
          const newMessages = [...prev]
          const lastMsg = newMessages[newMessages.length - 1]
          if (lastMsg?.role === 'assistant') {
            lastMsg.content = `Error: ${errorMessage}`
            lastMsg.isLoading = false
          }
          return newMessages
        })
        return null
      } finally {
        setLoading(false)
        setMessages((prev) => {
          const newMessages = [...prev]
          const lastMsg = newMessages[newMessages.length - 1]
          if (lastMsg?.role === 'assistant') lastMsg.isLoading = false
          return newMessages
        })
        abortControllerRef.current = null
      }
    },
    [selectedAgent, selectedTask, setMessages, messages],
  )

  const sendMessage = async () => {
    if (!input.trim() && attachments.length === 0) return
    const userMessage = input.trim()
    setInput('')
    const currentAttachments = [...attachments]
    setAttachments([])
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
    abortControllerRef.current?.abort()
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
  const placeholder = isTaskMode
    ? `Ask about task #${selectedTask?.issueNumber}...`
    : `Ask ${currentAgent.name}...`

  const canSend = input.trim() || attachments.length > 0

  return (
    <div className="relative flex flex-col h-full border-l bg-background">
      {/* Session Sidebar */}
      {showSessionSidebar && !isTaskMode && (
        <SessionSidebar
          sessions={sessionHook.sessions}
          activeSessionId={sessionHook.activeSession?.id || null}
          agentId={selectedAgent}
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
      {/* Header with agent and context */}
      <div className="pl-4 pr-12 md:pr-4 py-3 border-b bg-gradient-to-r from-muted/80 to-muted/40">
        <div className="flex items-center justify-between">
          {/* Left: Agent icon + name + message count */}
          <div className="flex items-center gap-2">
            <span className="text-xl" role="img" aria-label={currentAgent.name}>
              {currentAgent.icon}
            </span>
            <span className="font-semibold text-base">{currentAgent.name}</span>
            {messages.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-primary/10 text-primary text-xs rounded-full">
                {messages.length}
              </span>
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

          {/* Right: Agent selector dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowAgentDropdown(!showAgentDropdown)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-background rounded-md border border-transparent hover:border-border transition-all"
            >
              <span>Switch</span>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
            {showAgentDropdown && (
              <div className="absolute right-0 top-full mt-1 w-64 bg-background border rounded-lg shadow-xl z-50 overflow-hidden">
                <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b">
                  Select Agent
                </div>
                {AGENT_LIST.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => handleAgentChange(agent.id)}
                    className={`w-full text-left px-3 py-2.5 hover:bg-muted/50 flex items-start gap-3 transition-colors ${
                      agent.id === selectedAgent ? 'bg-primary/5 border-l-2 border-primary' : ''
                    }`}
                  >
                    <span className="text-lg mt-0.5">{agent.icon}</span>
                    <div>
                      <div className="font-medium text-sm">{agent.name}</div>
                      <div className="text-xs text-muted-foreground line-clamp-1">
                        {agent.description}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

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
                <div className="prose prose-base dark:prose-invert max-w-none">
                  <ReactMarkdown>
                    {msg.content || (msg.isLoading ? '_Thinking..._' : '')}
                  </ReactMarkdown>
                </div>
              ) : (
                msg.content
              )}
              {msg.isLoading && msg.role === 'assistant' && (
                <span className="inline-block ml-2 animate-pulse text-primary">●</span>
              )}
            </div>
          </div>
        ))}

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
