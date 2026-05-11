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
  Target,
  CheckCircle2,
} from 'lucide-react'
import { AGENT, AGENTS, type AgentId, type AgentConfig } from '../agents'

function buildAgentList(brainConfigured: boolean): Omit<AgentConfig, 'systemPrompt'>[] {
  return Object.values(AGENTS)
    .filter((a) => a.id !== 'kody-assistant')
    // `kody-speech` is a modality, not a user-selectable agent. The mic
    // button activates it under the hood; it must not appear in the
    // dropdown.
    .filter((a) => a.id !== 'kody-speech')
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

/**
 * Phase label for the Kody Live boot banner. Times are derived from the
 * live test (run 25437723431): queue ~10s, runner setup + checkout ~25s,
 * npx install + LiteLLM pip ~50s, model warm-up ~80s, ready by ~90s.
 * Estimates only — no GitHub API call.
 */
function bootPhaseLabel(elapsed: number): string {
  if (elapsed < 10) return 'Queueing workflow run'
  if (elapsed < 25) return 'Setting up GitHub Actions runner'
  if (elapsed < 50) return 'Installing Kody engine'
  if (elapsed < 80) return 'Starting LiteLLM proxy'
  if (elapsed < 110) return 'Warming up model'
  return 'Almost ready...'
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ─── Kody Live persistence ───────────────────────────────────────────────────
// Survives page refreshes by saving the live session to localStorage. Stale
// records (older than the engine's 30min hard cap + 5min idle buffer) are
// dropped on load.

const LIVE_SESSION_STORAGE_KEY = 'kody-live-session'
const LIVE_SESSION_MAX_AGE_MS = 35 * 60_000

interface PersistedLiveSession {
  sessionId: string
  state: 'booting' | 'ready'
  startedAt: number
  // Captured at /start time. Lets the booting banner render the
  // "Watching <owner>/<repo>" link after a refresh without waiting for
  // chat.ready to re-fire on the new SSE connection.
  target?: { owner: string; repo: string }
  // Captured when chat.ready arrives (engine ≥ 0.3.79). Survives refresh
  // so the deep link doesn't downgrade to the workflow-list page.
  runUrl?: string
}

function loadLiveSession(): PersistedLiveSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(LIVE_SESSION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedLiveSession
    if (!parsed.sessionId || typeof parsed.startedAt !== 'number') return null
    if (Date.now() - parsed.startedAt > LIVE_SESSION_MAX_AGE_MS) {
      window.localStorage.removeItem(LIVE_SESSION_STORAGE_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function saveLiveSession(record: PersistedLiveSession): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LIVE_SESSION_STORAGE_KEY, JSON.stringify(record))
  } catch {
    /* quota / disabled — non-fatal */
  }
}

function clearLiveSession(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(LIVE_SESSION_STORAGE_KEY)
  } catch {
    /* non-fatal */
  }
}

/** Add per-user Brain config headers on Brain-path requests. */
function brainHeaders(): Record<string, string> {
  const b = getStoredBrainConfig()
  return b ? { 'x-brain-url': b.url, 'x-brain-key': b.apiKey } : {}
}
import type { AttachmentRef, ChatContext, ChatMessage, ChatSession } from '../chat-types'
import {
  putAttachment,
  getAttachmentDataUrl,
  deleteAttachment,
  purgeOrphans,
} from '../attachment-store'
import { ConfirmDialog } from './ConfirmDialog'
import { useRemoteStatus } from '../hooks/useRemoteStatus'
import { useVoiceChat } from '../hooks/useVoiceChat'
import { VoiceButton } from './VoiceButton'
import { VoiceChatOverlay } from './VoiceChatOverlay'
import { useChatSessions } from '../hooks/useChatSessions'
import { useKodyActionState } from '../hooks/useKodyActionState'
import { SessionSidebar } from './SessionSidebar'
import { TaskSessionHistory } from './TaskSessionHistory'
import { ToolCallList, ThinkingPanel, ReasoningPanel, parseReasoning } from './ToolCallCard'
import { MessageActions } from './MessageActions'
import { loadTaskChatLocal, saveTaskChatLocal, clearTaskChatLocal } from '../task-chat-local'
import { loadJobChatLocal, saveJobChatLocal, clearJobChatLocal } from '../job-chat-local'
import { isSwitchAgentDirective } from '@dashboard/lib/chat-ui-actions'

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
  /** Attachment refs (blobs live in IndexedDB). */
  attachments?: AttachmentRef[]
  /**
   * Marks a synthetic "Error: …" message produced by the chat client when
   * a request fails. These are visible in the UI but MUST be filtered out
   * of the transcript sent back to the model — otherwise the next turn
   * sees a fake assistant reply describing an old failure and tries to
   * "respond" to it (e.g. apologizing for a stale KODY_SESSION_SECRET
   * error). Always paired with role: 'assistant'.
   */
  isError?: boolean
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
    attachments: chat.attachments,
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
    attachments: msg.attachments,
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
  /** IndexedDB record id — used to look up the blob on send/render. */
  id: string
  name: string
  type: string
  size: number
  /** Base64 data URL kept in memory for the live composer preview + send. */
  data: string
  mimeType: string
}

interface KodyChatProps {
  /**
   * What this chat is "about". Today only task-scoped chat is supported;
   * the discriminated union leaves room for other kinds (e.g. job
   * drafting) to be added in later phases without touching every access
   * site in this component.
   *
   * `null`/`undefined` = global chat (no scoped context).
   */
  context?: ChatContext | null
  /** GitHub login of the current user — used for remote dev status */
  actorLogin?: string | null
  /** Optional close handler — when set, renders a close `×` in the header (mobile sheet). */
  onClose?: () => void
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

/**
 * Render attachment chips (image preview for images, file icon otherwise)
 * inside a user message bubble. Pulls the blob bytes from IndexedDB on
 * mount so reload-from-history still shows the picture.
 */
function MessageAttachments({ attachments }: { attachments: AttachmentRef[] }) {
  const [previews, setPreviews] = useState<Record<string, string | null>>({})

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const next: Record<string, string | null> = {}
      for (const a of attachments) {
        if (!a.mimeType.startsWith('image/')) {
          next[a.id] = null
          continue
        }
        try {
          next[a.id] = await getAttachmentDataUrl(a.id)
        } catch {
          next[a.id] = null
        }
      }
      if (!cancelled) setPreviews(next)
    })()
    return () => {
      cancelled = true
    }
  }, [attachments])

  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {attachments.map((a) => {
        const dataUrl = previews[a.id]
        if (a.mimeType.startsWith('image/')) {
          return (
            <div
              key={a.id}
              className="relative max-w-[180px] rounded-md overflow-hidden border border-primary-foreground/20 bg-background/40"
              title={`${a.name} (${formatFileSize(a.size)})`}
            >
              {dataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={dataUrl}
                  alt={a.name}
                  className="block max-h-[180px] w-auto object-contain"
                />
              ) : (
                <div className="px-3 py-6 text-xs text-muted-foreground flex items-center gap-1.5">
                  <ImageIcon className="w-4 h-4" />
                  {dataUrl === null ? a.name : 'Loading…'}
                </div>
              )}
            </div>
          )
        }
        return (
          <div
            key={a.id}
            className="flex items-center gap-1.5 px-2 py-1 bg-background/30 rounded-md text-xs"
            title={`${a.mimeType} • ${formatFileSize(a.size)}`}
          >
            {getFileIcon(a.mimeType)}
            <span className="max-w-[140px] truncate">{a.name}</span>
            <span className="opacity-70">{formatFileSize(a.size)}</span>
          </div>
        )
      })}
    </div>
  )
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

export function KodyChat({ context, actorLogin, onClose }: KodyChatProps) {
  // Context-kind derivations.
  const selectedTask: KodyTask | null =
    context?.kind === 'task' ? context.task : null
  const selectedJob =
    context?.kind === 'job' ? context.job : null
  const draftId: string | null =
    context?.kind === 'job-draft' ? context.draftId : null
  const onFinalizeDraft =
    context?.kind === 'job-draft' ? context.onFinalize : undefined
  // Goal-planner mode: chat scoped to a Goal, used for the "Plan this goal"
  // workflow (Pass 1 list-in-chat → user approves → Pass 2 create issues).
  const plannerGoal =
    context?.kind === 'goal-planner' ? context.goal : null
  const plannerSessionId =
    context?.kind === 'goal-planner' ? context.sessionId : null
  const plannerExistingTasks =
    context?.kind === 'goal-planner' ? context.existingTasks : undefined
  const onPlannerTasksCreated =
    context?.kind === 'goal-planner' ? context.onTasksCreated : undefined
  const onPlannerExit =
    context?.kind === 'goal-planner' ? context.onExit : undefined
  // Report mode: chat scoped to a markdown report on /reports. The agent
  // is framed to advise: create issue, attach to a goal, or no action.
  const selectedReport =
    context?.kind === 'report' ? context.report : null

  // Task-scoped messages (loaded from / saved to API)
  const [taskMessages, setTaskMessages] = useState<Message[]>([])
  const [isLoadingTaskChat, setIsLoadingTaskChat] = useState(false)
  // Draft-scoped messages (ephemeral — no persistence). Cleared whenever a
  // new draft session opens (fresh draftId).
  const [draftMessages, setDraftMessages] = useState<Message[]>([])
  // Job-scoped messages keyed by job issue number. Ephemeral (lives
  // for the React session) — switching between jobs preserves each
  // thread so users can jump around without losing context. Persistence
  // across reloads would need a dedicated save/load API; deferred.
  const [jobMessagesBySlug, setJobMessagesBySlug] = useState<
    Record<string, Message[]>
  >({})
  // Goal-planner messages keyed by sessionId (one session per "Plan this
  // goal" launch). Ephemeral — same lifetime as jobMessagesBySlug.
  const [plannerMessagesBySession, setPlannerMessagesBySession] = useState<
    Record<string, Message[]>
  >({})

  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const dragCounterRef = useRef(0)
  const [loading, setLoading] = useState(false)
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId>('kody')
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [brainConfigured, setBrainConfigured] = useState(false)
  const brainAbortRef = useRef<AbortController | null>(null)
  const currentAgent = AGENTS[selectedAgentId] ?? AGENT
  const agentList = buildAgentList(brainConfigured)

  // Read Brain config once on mount. When Brain credentials were provided at
  // login, Brain becomes the default selection; otherwise Kody is the default.
  useEffect(() => {
    const configured = getStoredBrainConfig() !== null
    setBrainConfigured(configured)
    if (configured) {
      setSelectedAgentId('brain')
    }
  }, [])

  // If the user had Brain selected but then removed the config, fall back to Kody.
  useEffect(() => {
    if (selectedAgentId === 'brain' && !brainConfigured) {
      setSelectedAgentId('kody')
    }
  }, [brainConfigured, selectedAgentId])

  // Restore an in-progress Kody Live session after a page refresh. Reads
  // localStorage on mount; if a non-stale session exists, switches to the
  // live agent, restores state, and reconnects the SSE so chat.ready /
  // chat.message / chat.exit continue to flow. Runs once.
  const liveRestoreAttemptedRef = useRef(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [voiceMuted, setVoiceMuted] = useState(false)
  const [voiceOverlayOpen, setVoiceOverlayOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  // Kody Live (long-lived runner) — explicit warm-up flow:
  //   1. user picks 'kody-live' agent → chat input is disabled, banner shows
  //      "Start Live Runner" button.
  //   2. user clicks button → /start dispatches kody.yml → state='booting'.
  //   3. runner emits chat.ready (~90s) → state='ready', input enables.
  //   4. user chats normally; every send hits /append (no new dispatch).
  //   5. chat.exit (idle/cap) → state='ended', input disables, banner shows
  //      a re-start button.
  //
  // Refs (not state) because the SSE callback captures these in a closure;
  // state alone would be stale by the time chat.ready arrives.
  const interactiveSessionIdRef = useRef<string | null>(null)
  const interactiveStateRef = useRef<'idle' | 'booting' | 'ready' | 'ended'>('idle')
  // Display state mirrors the ref so React re-renders the input lock + banner.
  const [interactiveState, setInteractiveState] = useState<
    'idle' | 'booting' | 'ready' | 'ended'
  >('idle')
  // Where the runner was dispatched. Surfaced in the banner so users can
  // verify the connected repo + jump to its Actions tab if booting hangs.
  const [interactiveTarget, setInteractiveTarget] = useState<{
    owner: string
    repo: string
  } | null>(null)
  const interactiveTargetRef = useRef<{ owner: string; repo: string } | null>(null)
  // Direct URL to the specific GHA run, set when chat.ready arrives with
  // the engine's GITHUB_RUN_ID. Until then, we link to the workflow page.
  const [interactiveRunUrl, setInteractiveRunUrl] = useState<string | null>(null)
  // When booting started — drives the elapsed-time + phase indicator in the
  // banner. Reset to null on ready/ended so the next start re-anchors.
  const [bootStartedAt, setBootStartedAt] = useState<number | null>(null)
  const [bootElapsed, setBootElapsed] = useState(0)
  useEffect(() => {
    if (interactiveState !== 'booting' || !bootStartedAt) {
      setBootElapsed(0)
      return
    }
    const tick = () => setBootElapsed(Math.floor((Date.now() - bootStartedAt) / 1000))
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [interactiveState, bootStartedAt])

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

  // Mode discriminator. Exactly one of these is true at a time.
  const isTaskMode = !!selectedTask
  const isJobMode = !!selectedJob
  const isDraftMode = !!draftId
  const isPlannerMode = !!plannerGoal && !!plannerSessionId
  const isGlobalMode =
    !isTaskMode && !isJobMode && !isDraftMode && !isPlannerMode

  // Current messages — four stores, picked by mode.
  //  • task mode    → `taskMessages`        (loaded/saved via API)
  //  • job mode → `jobMessagesBySlug[slug]` (ephemeral, per job)
  //  • draft mode   → `draftMessages`       (ephemeral React state)
  //  • global mode  → `sessionHook`         (localStorage-backed)
  const jobSlug: string | null = selectedJob?.slug ?? null
  const currentJobMessages: Message[] =
    jobSlug != null ? jobMessagesBySlug[jobSlug] ?? [] : []
  const currentPlannerMessages: Message[] =
    plannerSessionId != null
      ? plannerMessagesBySession[plannerSessionId] ?? []
      : []

  const messages: Message[] = isTaskMode
    ? taskMessages
    : isJobMode
      ? currentJobMessages
      : isDraftMode
        ? draftMessages
        : isPlannerMode
          ? currentPlannerMessages
          : sessionHook.messages.map(chatToMessage)

  const setMessages = useCallback(
    (updater: Message[] | ((prev: Message[]) => Message[])) => {
      if (isTaskMode) {
        setTaskMessages((prev) => (typeof updater === 'function' ? updater(prev) : updater))
      } else if (isJobMode && jobSlug != null) {
        setJobMessagesBySlug((prev) => {
          const prevForJob = prev[jobSlug] ?? []
          const next = typeof updater === 'function' ? updater(prevForJob) : updater
          return { ...prev, [jobSlug]: next }
        })
      } else if (isDraftMode) {
        setDraftMessages((prev) => (typeof updater === 'function' ? updater(prev) : updater))
      } else if (isPlannerMode && plannerSessionId != null) {
        setPlannerMessagesBySession((prev) => {
          const prevForSession = prev[plannerSessionId] ?? []
          const next = typeof updater === 'function' ? updater(prevForSession) : updater
          return { ...prev, [plannerSessionId]: next }
        })
      } else {
        sessionHook.setMessages((prevChat: ChatMessage[]) => {
          const newMessages =
            typeof updater === 'function' ? updater(prevChat.map(chatToMessage)) : updater
          return newMessages.map(messageToChat)
        })
      }
    },
    [
      isTaskMode,
      isJobMode,
      jobSlug,
      isDraftMode,
      isPlannerMode,
      plannerSessionId,
      sessionHook,
    ],
  )

  // ─── Polling for Kody Live ─────────────────────────────────────────────────
  // Plain fixed-interval poll of /api/kody/events/poll. We tried real-time
  // push (engine HttpSink → /ingest → in-memory bus) but Vercel's per-
  // function-instance bus made it unreliable. Polling at 3s with ETag
  // caching on the server is simple and well-understood: most polls hit
  // GitHub's 304 cache (free), so the rate-limit cost is roughly ~1 read
  // per actual new event.
  const pollWatermarkRef = useRef(0)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopInteractivePoll = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }, [])

  const startInteractivePoll = useCallback(
    (sessionId: string) => {
      stopInteractivePoll()
      pollWatermarkRef.current = 0

      const handleLines = (lines: string[]) => {
        for (const line of lines) {
          let event: { event?: string; payload?: Record<string, unknown> } | null = null
          try {
            event = JSON.parse(line)
          } catch {
            continue
          }
          if (!event || !event.event) continue
          const payload = event.payload ?? {}
          switch (event.event) {
            case 'chat.ready': {
              interactiveStateRef.current = 'ready'
              setInteractiveState('ready')
              setBootStartedAt(null)
              const runUrl = typeof payload.runUrl === 'string' ? payload.runUrl : undefined
              if (runUrl) setInteractiveRunUrl(runUrl)
              const id = interactiveSessionIdRef.current
              if (id) {
                saveLiveSession({
                  sessionId: id,
                  state: 'ready',
                  startedAt: Date.now(),
                  target: interactiveTargetRef.current ?? undefined,
                  runUrl,
                })
              }
              break
            }
            case 'chat.exit': {
              interactiveStateRef.current = 'ended'
              setInteractiveState('ended')
              setLoading(false)
              clearLiveSession()
              stopInteractivePoll()
              break
            }
            case 'chat.message': {
              const role =
                payload.role === 'user' || payload.role === 'assistant' ? payload.role : 'assistant'
              const content = typeof payload.content === 'string' ? payload.content : ''
              const timestamp =
                typeof payload.timestamp === 'string' ? payload.timestamp : new Date().toISOString()
              setMessages((prev) => [
                ...prev.filter((m) => !(m.role === 'assistant' && m.isLoading)),
                { role, content, timestamp, isLoading: false },
              ])
              break
            }
            case 'chat.done':
              setLoading(false)
              break
            case 'chat.error': {
              setLoading(false)
              const error = typeof payload.error === 'string' ? payload.error : 'Unknown error'
              setMessages((prev) => {
                const filtered = prev.filter((m) => !(m.role === 'assistant' && m.isLoading))
                return [
                  ...filtered,
                  { role: 'assistant', content: `Error: ${error}`, isLoading: false, isError: true },
                ]
              })
              break
            }
          }
        }
      }

      const tick = async () => {
        const auth = getStoredAuth()
        const params = new URLSearchParams({
          taskId: sessionId,
          since: String(pollWatermarkRef.current),
        })
        if (auth) {
          params.set('owner', auth.owner)
          params.set('repo', auth.repo)
          params.set('token', auth.token)
        }
        try {
          const res = await fetch(`/api/kody/events/poll?${params.toString()}`, {
            headers: { ...authHeaders() },
          })
          if (!res.ok) return
          const body = (await res.json()) as { lines?: string[]; totalLines?: number }
          if (Array.isArray(body.lines) && body.lines.length > 0) {
            handleLines(body.lines)
            pollWatermarkRef.current =
              body.totalLines ?? pollWatermarkRef.current + body.lines.length
          }
        } catch {
          // transient — next tick will retry
        }
      }

      // Fire once immediately so chat.ready already on git lands without
      // a 3s wait. Subsequent ticks every 3s — most are free 304s thanks
      // to ETag caching on the server side.
      void tick()
      pollIntervalRef.current = setInterval(tick, 3_000)
    },
    [setMessages],
  )

  // ─── SSE for chat streaming ────────────────────────────────────────────────

  const connectSSE = useCallback(
    (sessionId: string, opts: { interactive?: boolean } = {}) => {
      // Close any existing connection
      eventSourceRef.current?.close()

      // EventSource cannot attach custom headers — we pass the same auth
      // triplet as query params so the stream route can resolve the target
      // repo + GitHub token the same way the other chat endpoints do.
      const auth = getStoredAuth()
      const params = new URLSearchParams({ taskId: sessionId })
      // mode=interactive keeps the SSE alive across multiple chat.done
      // events (one per turn). Closes only on chat.exit.
      if (opts.interactive) params.set('mode', 'interactive')
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
            case 'chat.ready': {
              interactiveStateRef.current = 'ready'
              setInteractiveState('ready')
              setBootStartedAt(null)
              const id = interactiveSessionIdRef.current
              const runUrl = typeof parsed.runUrl === 'string' ? parsed.runUrl : undefined
              if (runUrl) setInteractiveRunUrl(runUrl)
              if (id) {
                saveLiveSession({
                  sessionId: id,
                  state: 'ready',
                  startedAt: Date.now(),
                  target: interactiveTargetRef.current ?? undefined,
                  runUrl,
                })
              }
              break
            }
            case 'chat.exit': {
              interactiveStateRef.current = 'ended'
              setInteractiveState('ended')
              setLoading(false)
              clearLiveSession()
              es.close()
              break
            }
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
              // In interactive mode, chat.done is per-turn — keep SSE open;
              // the runner stays alive until chat.exit.
              if (!opts.interactive) es.close()
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
                    isError: true,
                  },
                ]
              })
              if (!opts.interactive) es.close()
              break
            }
          }
        } catch {
          // skip malformed
        }
      }

      es.onerror = () => {
        // Don't close: EventSource auto-reconnects on transient errors
        // (network blip, Vercel idle TCP timeout). Closing here permanently
        // breaks long-lived interactive sessions.
        setLoading(false)
      }

      // Vercel's Node runtime buffers SSE responses for long-lived
      // connections — events sit in the buffer until the connection
      // closes. A fresh connection drains the buffer immediately and
      // reads the events from GitHub, so we sidestep the bug by cycling
      // the connection every 25s when in interactive mode. Each cycle
      // re-pulls all events from the events file (the server clears its
      // per-session lastReadIndex on every new connection, so it replays
      // from line 0; client-side seenEventIds deduplicates).
      if (opts.interactive) {
        const cycleTimer = setTimeout(() => {
          if (eventSourceRef.current === es) connectSSE(sessionId, opts)
        }, 25_000)
        // Cancel the cycle if a NEW connectSSE supersedes us before 25s.
        const orig = es.close.bind(es)
        es.close = () => {
          clearTimeout(cycleTimer)
          orig()
        }
      }
    },
    [setMessages],
  )

  // Open SSE whenever we have a scoped session id — task id for task mode,
  // `job-{number}` for job mode, draft id for job drafting.
  // Global-mode streams are opened on demand inside the send path.
  //
  // Tab-visibility gate: the server-side SSE handler polls GitHub every 3s as
  // a fallback for cross-instance push. With hundreds of background tabs that
  // drains the shared GH rate-limit token. Closing the EventSource on
  // `visibilityState=hidden` halts the server poll (req.signal.abort fires);
  // we reopen on `visible`. Loss of in-flight push events is acceptable —
  // chat history is hydrated from /api/kody/chat/load on next view.
  useEffect(() => {
    const sid =
      selectedTask?.id ??
      (jobSlug != null ? `job-${jobSlug}` : null) ??
      draftId ??
      null
    if (!sid) {
      return () => {
        eventSourceRef.current?.close()
      }
    }

    const open = () => {
      if (eventSourceRef.current && eventSourceRef.current.readyState !== EventSource.CLOSED) return
      connectSSE(sid)
    }
    const close = () => {
      eventSourceRef.current?.close()
      eventSourceRef.current = null
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') open()
      else close()
    }

    if (document.visibilityState === 'visible') open()
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      close()
    }
  }, [selectedTask?.id, jobSlug, draftId, connectSSE])

  // Reset the ephemeral draft buffer whenever a new draft session opens.
  useEffect(() => {
    if (isDraftMode) setDraftMessages([])
  }, [draftId, isDraftMode])

  // Load task chat when task changes.
  //
  // Two-tier hydration: localStorage first (instant, covers branchless tasks
  // whose server save no-ops), then server. Server wins when it has data —
  // it's canonical for any task with a pipeline branch. If the server returns
  // empty, keep whatever local had (the task likely has no branch yet).
  useEffect(() => {
    if (selectedTask) {
      // Tier 1 — local mirror, synchronous, no network.
      const localMsgs = loadTaskChatLocal(selectedTask.id)
      if (localMsgs.length > 0) {
        setTaskMessages(localMsgs.map(chatToMessage))
      } else {
        setTaskMessages([])
      }

      // Tier 2 — server fetch. Reconcile when it returns.
      setIsLoadingTaskChat(true)
      fetch(`/api/kody/chat/load?taskId=${selectedTask.id}`)
        .then(async (res) => {
          if (!res.ok) return null
          const data = await res.json()
          return data as { sessions: ChatSession[] } | null
        })
        .then((data) => {
          if (!data?.sessions) return

          setTaskSessions(data.sessions)

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

          // Server wins only when it actually has dashboard messages. Empty
          // server response = branchless task, keep local mirror in place.
          if (converted.length > 0) {
            setTaskMessages(converted)
            // Server is now canonical — drop local mirror.
            clearTaskChatLocal(selectedTask.id)
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

      const res = await fetch('/api/kody/chat/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          taskId: selectedTask.id,
          messages: messagesForApi,
        }),
      })

      // If the server actually persisted (branch exists, not the no-branch
      // skip path), drop the local mirror — server is canonical now.
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { success?: boolean; skipped?: string }
          | null
        if (body?.success && body.skipped !== 'no-branch') {
          clearTaskChatLocal(selectedTask.id)
        }
      }
    } catch (err) {
      console.error('Failed to save chat:', err)
      // Non-fatal — local mirror still covers refresh.
    }
  }, [selectedTask?.id, taskMessages]) // eslint-disable-line react-hooks/exhaustive-deps -- intentional: only id needed, full object ref changes on every poll

  // Mirror task chat to localStorage immediately on every change. Covers
  // branchless tasks (where server save no-ops) and bridges the 2s debounce
  // window before server save fires.
  //
  // Dep is `selectedTask?.id` not `selectedTask` because the parent rebuilds
  // the task object on every poll. Empty taskMessages is a no-op — otherwise
  // a second KodyChat instance (e.g. PreviewModal's panel) that hasn't loaded
  // yet would clobber the localStorage entry written by the active instance.
  useEffect(() => {
    if (!isTaskMode || !selectedTask || taskMessages.length === 0) return
    const messagesForLocal: ChatMessage[] = taskMessages.map((m) => ({
      role: m.role,
      text: m.content,
      timestamp: m.timestamp || new Date().toISOString(),
    }))
    saveTaskChatLocal(selectedTask.id, messagesForLocal)
  }, [taskMessages, isTaskMode, selectedTask?.id]) // eslint-disable-line react-hooks/exhaustive-deps -- intentional: only id needed, full object ref changes on every poll

  // Save after streaming completes — skip saves while loading to avoid race conditions
  useEffect(() => {
    if (isTaskMode && taskMessages.length > 0 && !loading) {
      const timer = setTimeout(saveTaskChat, 2000)
      return () => clearTimeout(timer)
    }
  }, [taskMessages, isTaskMode, loading, saveTaskChat])

  // Hydrate job chat from localStorage on slug change. We only hydrate
  // when the in-memory entry for this slug is `undefined` (never seen
  // this session) — once the user starts adding messages, the in-memory
  // store is the source of truth and we don't reread from disk.
  useEffect(() => {
    if (!isJobMode || !jobSlug) return
    if (jobMessagesBySlug[jobSlug] !== undefined) return
    const local = loadJobChatLocal(jobSlug)
    if (local.length === 0) return
    setJobMessagesBySlug((prev) => {
      if (prev[jobSlug] !== undefined) return prev
      return { ...prev, [jobSlug]: local.map(chatToMessage) }
    })
  }, [isJobMode, jobSlug, jobMessagesBySlug])

  // Persist job chat on every change. localStorage write is sync and cheap;
  // no need to debounce. An empty array clears the entry so a deleted /
  // reset thread doesn't haunt future visits.
  useEffect(() => {
    if (!isJobMode || !jobSlug) return
    const msgs = currentJobMessages
    if (msgs.length === 0) {
      clearJobChatLocal(jobSlug)
      return
    }
    saveJobChatLocal(
      jobSlug,
      msgs.map((m) => ({
        role: m.role,
        text: m.content,
        timestamp: m.timestamp || new Date().toISOString(),
      })),
    )
  }, [isJobMode, jobSlug, currentJobMessages])

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

  // Garbage-collect IDB attachment blobs that no message references any
  // more. Runs once on mount across all stored sessions plus the current
  // task chat — cheap, since the cursor only reads keys.
  useEffect(() => {
    const referenced = new Set<string>()
    // Global sessions (from the session hook)
    for (const m of sessionHook.messages) {
      m.attachments?.forEach((a) => referenced.add(a.id))
    }
    // Current task chat
    for (const m of taskMessages) {
      m.attachments?.forEach((a) => referenced.add(a.id))
    }
    // Pending composer attachments (not yet sent)
    attachments.forEach((a) => referenced.add(a.id))
    purgeOrphans(referenced).catch((err) =>
      console.error('IDB purgeOrphans failed:', err),
    )
    // We intentionally only run this on mount — running on every message
    // change would race with in-flight uploads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const executeClearHistory = () => {
    // Only touch the localStorage session store in real global mode — draft
    // mode is ephemeral and shares nothing with sessionHook.
    if (isGlobalMode) {
      sessionHook.clearActiveSession()
    }

    setMessages([])
    setToolCalls([])

    // If in task mode, also clear the saved chat
    if (isTaskMode && selectedTask) {
      clearTaskChatLocal(selectedTask.id)
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

  // Process incoming files (from picker or drag-and-drop). Reads each file,
  // persists the blob to IndexedDB, and appends a chip to the composer.
  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (list.length === 0) return

    const MAX_SIZE = 5 * 1024 * 1024 // 5MB
    const newAttachments: Attachment[] = []

    for (const file of list) {
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

        // Persist the blob in IndexedDB so it survives reload and we can
        // re-render the chip from history without keeping base64 in
        // localStorage. The returned `id` is the canonical attachment id.
        let storedId: string
        try {
          const ref = await putAttachment({
            name: file.name,
            mimeType: file.type,
            size: file.size,
            blob: file,
          })
          storedId = ref.id
        } catch (idbErr) {
          // IDB unavailable (private mode, quota, etc.) — fall back to
          // a transient id; the message just won't be re-renderable
          // after reload.
          console.error('IDB putAttachment failed:', idbErr)
          storedId = `mem-${Date.now()}-${Math.random().toString(36).slice(2)}`
        }

        newAttachments.push({
          id: storedId,
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

    if (newAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...newAttachments])
    }
  }

  // Handle file selection from the hidden <input type="file">
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    await addFiles(files)
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Drag-and-drop handlers on the chat container. We use a counter to
  // survive child-element dragenter/leave bubbling (otherwise the overlay
  // flickers as the cursor moves over inner nodes).
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    dragCounterRef.current += 1
    setIsDraggingFile(true)
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types.includes('Files')) return
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
    if (dragCounterRef.current === 0) setIsDraggingFile(false)
  }

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDraggingFile(false)
    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      await addFiles(files)
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
    // Drop the IDB blob too — the user removed it before sending, so
    // nothing references it any more.
    deleteAttachment(id).catch((err) =>
      console.error('IDB deleteAttachment failed:', err),
    )
  }

  const sendText = useCallback(
    async (
      messageContent: string,
      currentAttachments: Attachment[] = [],
      options: { voiceMode?: boolean } = {},
    ): Promise<string | null> => {
      if (!messageContent.trim() && currentAttachments.length === 0) return null

      // Voice mode forces the in-process Gemini path and the speech-tuned
      // system prompt regardless of which agent is selected in the
      // dropdown. The dropdown is a text-modality picker only.
      const voiceMode = options.voiceMode === true
      const effectiveAgentId: AgentId = voiceMode ? 'kody-speech' : selectedAgentId

      const timestamp = new Date().toISOString()

      // Attachment refs (id + metadata) for the persisted message. The blob
      // itself lives in IDB; the data URL stays in `currentAttachments` for
      // this turn's outgoing request only.
      const attachmentRefs: AttachmentRef[] = currentAttachments.map((a) => ({
        id: a.id,
        name: a.name,
        mimeType: a.mimeType,
        size: a.size,
      }))

      // The user's bubble shows just the typed text — the attachment chips
      // are rendered separately from `attachments`. No base64 in the text.
      const displayContent = messageContent

      // Build the prior-conversation transcript for the Kody backend. It
      // gets the cleaned-up text only; older attachments are referenced by
      // ref count only (not re-uploaded) — Kody's stateless route only
      // needs the current turn's images.
      // Build the transcript we send back to the model. Three rules:
      //
      // 1. Strip <think>…</think> blocks from any assistant content. The
      //    chat client wraps Gemini thought summaries in those tags so
      //    the collapsed reasoning panel can render them, but the model
      //    should never see its own private thoughts replayed as prior
      //    "assistant" turns — it triggers a narration loop where the
      //    next reply continues thinking-style ("I must acknowledge…").
      // 2. Drop synthetic error bubbles. isError: true catches the
      //    tagged ones; the "Error: " content prefix catches legacy
      //    persisted bubbles saved before the flag existed.
      // 3. Drop empty assistant bubbles (no real text after stripping).
      //    They come from aborted turns or turns where the model only
      //    produced reasoning. Sending them back makes Gemini "continue
      //    from nothing" and often regress into apologies.
      const stripThinkingTags = (content: string): string =>
        content.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim()

      const priorMessages = messages
        .map((m) => {
          if (m.role !== 'assistant') return m
          if (m.isError) return null
          if (m.content.startsWith('Error: ')) return null
          const cleaned = stripThinkingTags(m.content)
          if (!cleaned) return null
          return { ...m, content: cleaned }
        })
        .filter((m): m is Message => m !== null)
        .map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp ?? timestamp,
        }))

      setMessages((prev) => [
        ...prev,
        {
          role: 'user',
          content: displayContent,
          timestamp,
          attachments: attachmentRefs.length > 0 ? attachmentRefs : undefined,
        },
      ])

      // Resolve the session id only for backends that actually need one
      // (engine + brain). The kody-direct route is stateless and doesn't
      // use it. We defer createSession() to those branches because calling
      // it eagerly here creates a *second* session — the first setMessages
      // above already auto-created one, but `sessionHook.activeSession` is
      // a stale closure and reads as null, tripping createSession() into
      // splitting user/assistant across two sessions.
      const resolveSessionId = (): string => {
        if (selectedTask) return selectedTask.id
        if (jobSlug != null) return `job-${jobSlug}`
        if (draftId) return draftId
        return sessionHook.activeSession?.id ?? sessionHook.createSession()
      }

      setLoading(true)
      setToolCalls([])

      // Placeholder assistant message — will be replaced by SSE events
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '', isLoading: true, timestamp: new Date().toISOString() },
      ])

      // ─── Brain backend: sync SSE stream directly from /api/kody/chat/brain ───
      // Voice mode bypasses Brain (different prompt + backend) — fall through
      // to the kody-direct branch below.
      if (!voiceMode && selectedAgentId === 'brain') {
        brainAbortRef.current?.abort()
        const abort = new AbortController()
        brainAbortRef.current = abort

        // Scope chat memory per user + per task so every issue gets its own
        // Brain session. `sessionId` alone (a bare issue number) would collide
        // across users working on the same task.
        const userKey = actorLogin ?? 'anon'
        const brainSessionId = resolveSessionId()
        const brainChatId = selectedTask
          ? `${userKey}--task-${selectedTask.id}`
          : selectedJob
            ? `${userKey}--job-${selectedJob.slug}`
            : draftId
              ? `${userKey}--job-draft-${draftId}`
              : `${userKey}--global-${brainSessionId}`

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
              ...(selectedJob
                ? {
                    jobContext: {
                      slug: selectedJob.slug,
                      title: selectedJob.title,
                      body: selectedJob.body,
                    },
                  }
                : {}),
              ...(brainAttachments.length > 0 ? { attachments: brainAttachments } : {}),
              ...(isDraftMode ? { jobDraft: true } : {}),
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
                    isError: true,
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
              { role: 'assistant', content: `Error: ${errorMessage}`, isLoading: false, isError: true },
            ]
          })
          return null
        }
      }

      // ─── Kody direct backend: in-process LLM stream, no Actions/Brain ───
      // Any agent with backend === 'kody-direct' routes here, and voice
      // mode is forced here as well so the mic always uses Gemini + the
      // speech prompt regardless of the dropdown selection.
      if (voiceMode || currentAgent.backend === 'kody-direct') {
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

        // Build the user-turn content. If we have attachments, send them as
        // structured parts (text + image) so Gemini sees real images, not
        // base64 strings stuffed into the text. Without attachments, send
        // a plain string to keep the request shape identical to before.
        const userTurnContent: unknown =
          currentAttachments.length > 0
            ? [
                ...(messageContent.trim()
                  ? [{ type: 'text' as const, text: messageContent }]
                  : []),
                ...currentAttachments.map((a) =>
                  a.mimeType.startsWith('image/')
                    ? {
                        type: 'image' as const,
                        image: a.data,
                        mimeType: a.mimeType,
                      }
                    : {
                        type: 'file' as const,
                        data: a.data,
                        mediaType: a.mimeType,
                        filename: a.name,
                      },
                ),
              ]
            : messageContent

        const kodyMessages = [
          ...priorMessages.map((m) => ({ role: m.role, content: m.content })),
          { role: 'user' as const, content: userTurnContent },
        ]

        try {
          const res = await fetch('/api/kody/chat/kody', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({
              messages: kodyMessages,
              task: kodyTaskContext,
              agentId: effectiveAgentId,
              ...(actorLogin ? { actorLogin } : {}),
              ...(isDraftMode ? { jobDraft: true } : {}),
              ...(selectedJob
                ? {
                    job: {
                      slug: selectedJob.slug,
                      title: selectedJob.title,
                      body: selectedJob.body,
                    },
                  }
                : {}),
              ...(selectedReport
                ? {
                    report: {
                      slug: selectedReport.slug,
                      title: selectedReport.title,
                      body: selectedReport.body,
                    },
                  }
                : {}),
              ...(isPlannerMode && plannerGoal
                ? {
                    goalPlanner: true,
                    goal: {
                      id: plannerGoal.id,
                      name: plannerGoal.name,
                      description: plannerGoal.description,
                      dueDate: plannerGoal.dueDate,
                      ...(plannerExistingTasks
                        ? { existingTasks: plannerExistingTasks }
                        : {}),
                    },
                  }
                : {}),
            }),
          })

          if (!res.ok || !res.body) {
            const errText = await res.text().catch(() => '')
            throw new Error(errText || `HTTP ${res.status}`)
          }

          // The kody route streams Vercel AI SDK UI messages as SSE
          // (`data: {json}\n\n`). Parse incrementally and split into two
          // buffers: `reasoning` (Gemini thought summaries — wrapped in
          // <think>…</think> so ReasoningPanel renders them collapsed)
          // and `text` (the visible answer).
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let sseBuf = ''
          let reasoningBuf = ''
          let textBuf = ''
          // Map of toolCallId → toolName, populated from `tool-input-available`
          // chunks so we can identify the source tool when its
          // `tool-output-available` arrives (the output chunk omits the name).
          const toolNameById = new Map<string, string>()
          // Pending UI directives surfaced by tools. Applied AFTER the stream
          // closes so the assistant bubble settles before the agent flips —
          // otherwise the in-flight message would be re-routed mid-render.
          let pendingSwitchAgent: ReturnType<typeof JSON.parse> | null = null

          const composeContent = () =>
            (reasoningBuf ? `<think>${reasoningBuf}</think>\n\n` : '') + textBuf

          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            sseBuf += decoder.decode(value, { stream: true })

            // Process complete SSE events (separated by blank lines).
            let sep: number
            while ((sep = sseBuf.indexOf('\n\n')) !== -1) {
              const event = sseBuf.slice(0, sep)
              sseBuf = sseBuf.slice(sep + 2)
              if (!event.startsWith('data:')) continue
              const payload = event.slice(5).trim()
              if (!payload || payload === '[DONE]') continue
              try {
                const chunk = JSON.parse(payload) as
                  | { type: 'text-delta'; delta: string }
                  | { type: 'reasoning-delta'; delta: string }
                  | { type: 'error'; errorText: string }
                  | { type: 'tool-input-available'; toolCallId: string; toolName: string }
                  | { type: 'tool-output-available'; toolCallId: string; output: unknown }
                  | { type: string }
                if (chunk.type === 'text-delta' && 'delta' in chunk) {
                  textBuf += chunk.delta
                } else if (chunk.type === 'reasoning-delta' && 'delta' in chunk) {
                  // Voice mode never shows or speaks reasoning. Drop the
                  // chunks at the source so the bubble equals textBuf
                  // and TTS gets exactly what the user reads. Server-side
                  // we also disable thinking for kody-speech, but the SDK
                  // can occasionally leak a stray reasoning event — this
                  // is the belt-and-suspenders guard.
                  if (!voiceMode) reasoningBuf += chunk.delta
                } else if (chunk.type === 'error' && 'errorText' in chunk) {
                  textBuf += `\n\n[Error] ${chunk.errorText}`
                } else if (
                  chunk.type === 'tool-input-available' &&
                  'toolCallId' in chunk &&
                  'toolName' in chunk
                ) {
                  toolNameById.set(chunk.toolCallId, chunk.toolName)
                } else if (
                  chunk.type === 'tool-output-available' &&
                  'toolCallId' in chunk &&
                  'output' in chunk
                ) {
                  const name = toolNameById.get(chunk.toolCallId)
                  if (name === 'switch_agent' && isSwitchAgentDirective(chunk.output)) {
                    // Defer the dispatch — see comment on pendingSwitchAgent.
                    pendingSwitchAgent = chunk.output
                  }
                }
              } catch {
                // Ignore malformed chunks rather than aborting the stream.
              }
            }

            const content = composeContent()
            setMessages((prev) => {
              const copy = [...prev]
              const idx = copy.findIndex((m) => m.role === 'assistant' && m.isLoading)
              if (idx >= 0) {
                copy[idx] = { ...copy[idx], content, isLoading: true }
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
          // Apply any UI-control directives the model emitted. Done after
          // the assistant bubble settles so the agent flip doesn't race
          // the in-flight render or interrupt voice TTS that is still
          // speaking the confirmation sentence.
          if (pendingSwitchAgent && isSwitchAgentDirective(pendingSwitchAgent)) {
            const target = pendingSwitchAgent
            setSelectedAgentId(target.agentId)
            // If voice is active and the new agent isn't a voice-tunable
            // kody-direct backend, close the overlay. Voice mode forces
            // every message to kody-speech regardless of the dropdown
            // (see sendText), so leaving voice open after switching to
            // e.g. kody-live would silently keep routing to Gemini.
            const targetBackend = AGENTS[target.agentId]?.backend
            if (voiceMode && targetBackend !== 'kody-direct') {
              setVoiceOverlayOpen(false)
            }
          }
          // Planner mode: a Pass 2 turn typically creates one or more issues
          // via `create_task_for_goal`. We can't observe per-tool results
          // from this stream protocol cheaply, so fire the host callback on
          // every successful planner completion. The host (GoalControl)
          // invalidates `useKodyTasks`; the cache layer dedups the cost.
          if (isPlannerMode && onPlannerTasksCreated) {
            try {
              onPlannerTasksCreated()
            } catch {
              // Host callback errors should never break the chat.
            }
          }
          // Voice mode needs the spoken text only — no reasoning, no
          // empty string. `textBuf` is the answer the model would render
          // in a normal text bubble.
          return textBuf.trim() || null
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error'
          setLoading(false)
          setMessages((prev) => {
            const filtered = prev.filter((m) => !(m.role === 'assistant' && m.isLoading))
            return [
              ...filtered,
              { role: 'assistant', content: `Error: ${errorMessage}`, isLoading: false, isError: true },
            ]
          })
          return null
        }
      }

      // ─── Kody Live: long-lived interactive runner ───
      // The session must be warmed up (Start button → chat.ready) before the
      // user can send. The input is disabled until interactiveState='ready',
      // so by the time we get here in kody-live mode, the runner is alive
      // and we just /append.
      if (selectedAgentId === 'kody-live') {
        const liveSessionId = interactiveSessionIdRef.current
        if (interactiveStateRef.current !== 'ready' || !liveSessionId) {
          // Defensive: input should already be disabled. Surface as a hint.
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: 'The live runner is not ready yet. Click "Start Live Runner" first.',
              isLoading: false,
            },
          ])
          return null
        }

        const liveUserContent =
          currentAttachments.length > 0
            ? currentAttachments
                .map((a) => {
                  const sizeStr = formatFileSize(a.size)
                  if (a.mimeType.startsWith('image/')) return `[Image: ${a.name} (${sizeStr})]\n${a.data}`
                  return `[File: ${a.name} (${a.mimeType}, ${sizeStr})]\n${a.data}`
                })
                .join('\n\n') + (messageContent ? `\n\n${messageContent}` : '')
            : messageContent

        try {
          const appendRes = await fetch('/api/kody/chat/interactive/append', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({
              taskId: liveSessionId,
              content: liveUserContent,
              timestamp,
            }),
          })
          if (!appendRes.ok) {
            const body = (await appendRes.json().catch(() => ({}))) as { error?: string }
            throw new Error(body.error ?? `HTTP ${appendRes.status}`)
          }
          return null
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          setLoading(false)
          setMessages((prev) => {
            const filtered = prev.filter((m) => !(m.role === 'assistant' && m.isLoading))
            return [
              ...filtered,
              { role: 'assistant', content: `Error: ${errorMessage}`, isLoading: false, isError: true },
            ]
          })
          return null
        }
      }

      // ─── Kody engine backend: async via GH Actions workflow ───
      const sessionId = resolveSessionId()
      // The engine's trigger workflow expects plain string content. To keep
      // attachment info available on the workflow side without breaking the
      // schema, inline a compact descriptor + base64 into the user turn the
      // same way the previous behavior did.
      const engineUserContent =
        currentAttachments.length > 0
          ? currentAttachments
              .map((a) => {
                const sizeStr = formatFileSize(a.size)
                if (a.mimeType.startsWith('image/')) {
                  return `[Image: ${a.name} (${sizeStr})]\n${a.data}`
                }
                return `[File: ${a.name} (${a.mimeType}, ${sizeStr})]\n${a.data}`
              })
              .join('\n\n') + (messageContent ? `\n\n${messageContent}` : '')
          : messageContent

      const engineMessages = [
        ...priorMessages,
        { role: 'user' as const, content: engineUserContent, timestamp },
      ]

      try {
        const triggerRes = await fetch('/api/kody/chat/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            taskId: sessionId,
            messages: engineMessages,
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
            { role: 'assistant', content: `Error: ${errorMessage}`, isLoading: false, isError: true },
          ]
        })
        return null
      }
    },
    [
      selectedTask,
      selectedJob,
      jobSlug,
      draftId,
      isDraftMode,
      isPlannerMode,
      plannerGoal,
      plannerExistingTasks,
      onPlannerTasksCreated,
      setMessages,
      messages,
      selectedAgentId,
      actorLogin,
      sessionHook,
      connectSSE,
    ],
  )

  // Planner auto-kickoff. The "Plan with chat" button is the user's consent
  // to start; landing them on a blank prompt and asking them to type "go" is
  // a wasted click. We fire Pass 1 automatically on first render of a fresh
  // planner session. Guarded by a ref keyed on sessionId so re-renders,
  // mode toggles, and cleared chats can't re-trigger.
  const plannerAutoKickedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!isPlannerMode || !plannerSessionId || !plannerGoal) return
    if (plannerAutoKickedRef.current === plannerSessionId) return
    if (currentPlannerMessages.length > 0) {
      plannerAutoKickedRef.current = plannerSessionId
      return
    }
    plannerAutoKickedRef.current = plannerSessionId
    // Defer one microtask so the chat's setMessages plumbing has committed
    // for this session before sendText reads/writes it.
    void Promise.resolve().then(() => {
      sendText(
        `Plan tasks for the goal "${plannerGoal.name}". Run Pass 1 now: ` +
          'output the proposed task list (3–8 tasks), then wait for my approval.',
      )
    })
  }, [
    isPlannerMode,
    plannerSessionId,
    plannerGoal,
    currentPlannerMessages.length,
    sendText,
  ])

  // Kody Live: warm-up the long-lived runner. Wires the dispatch + SSE
  // for an interactive session. Chat input stays disabled until the runner
  // emits chat.ready (handled in connectSSE).
  const startInteractiveSession = useCallback(async () => {
    if (interactiveStateRef.current === 'booting' || interactiveStateRef.current === 'ready') return

    const sessionId = `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const startedAt = Date.now()
    interactiveSessionIdRef.current = sessionId
    interactiveStateRef.current = 'booting'
    setInteractiveState('booting')
    setBootStartedAt(startedAt)
    setInteractiveRunUrl(null)
    saveLiveSession({ sessionId, state: 'booting', startedAt })

    try {
      // dashboardUrl re-enabled — engine pushes events to /ingest in
      // real time so chat replies don't wait for the 3s file-poll. Auth
      // on /ingest is GitHub Actions IP verification (no shared secret).
      const dashboardUrl =
        typeof window !== 'undefined' ? `${window.location.origin}/api/kody/events/ingest` : undefined
      const startRes = await fetch('/api/kody/chat/interactive/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          taskId: sessionId,
          dashboardUrl,
          idleExitMs: 5 * 60_000,
          hardCapMs: 30 * 60_000,
        }),
      })
      if (!startRes.ok) {
        const body = (await startRes.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${startRes.status}`)
      }
      const startBody = (await startRes.json().catch(() => ({}))) as {
        target?: { owner: string; repo: string }
      }
      if (startBody.target) {
        setInteractiveTarget(startBody.target)
        interactiveTargetRef.current = startBody.target
        // Re-save with target so a refresh during boot still shows the link.
        saveLiveSession({
          sessionId,
          state: 'booting',
          startedAt,
          target: startBody.target,
        })
      }
      startInteractivePoll(sessionId)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      interactiveStateRef.current = 'ended'
      setInteractiveState('ended')
      clearLiveSession()
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Failed to start live runner: ${errorMessage}`, isLoading: false },
      ])
    }
  }, [connectSSE, setMessages])

  // Cancel a Kody Live session locally. Closes the SSE, clears the saved
  // record, and flips state to 'idle' so the user can start a fresh one.
  // Does NOT actively cancel the GitHub Actions run — the runner idle-exits
  // on its own (default 5min) so leaving it alone is cheap.
  const endInteractiveSession = useCallback(() => {
    stopInteractivePoll()
    eventSourceRef.current?.close()
    eventSourceRef.current = null
    interactiveSessionIdRef.current = null
    interactiveStateRef.current = 'idle'
    setInteractiveState('idle')
    setBootStartedAt(null)
    setInteractiveTarget(null)
    interactiveTargetRef.current = null
    setInteractiveRunUrl(null)
    clearLiveSession()
  }, [stopInteractivePoll])

  // Restore on page refresh. Runs once after connectSSE is stable. If the
  // user had a live session in flight, switch to kody-live, rehydrate the
  // refs from localStorage, and reconnect the SSE so the rest of the
  // session's events flow normally.
  useEffect(() => {
    if (liveRestoreAttemptedRef.current) return
    liveRestoreAttemptedRef.current = true
    const saved = loadLiveSession()
    if (!saved) return
    interactiveSessionIdRef.current = saved.sessionId
    interactiveStateRef.current = saved.state
    setInteractiveState(saved.state)
    setSelectedAgentId('kody-live')
    if (saved.state === 'booting') setBootStartedAt(saved.startedAt)
    if (saved.target) {
      setInteractiveTarget(saved.target)
      interactiveTargetRef.current = saved.target
    }
    if (saved.runUrl) setInteractiveRunUrl(saved.runUrl)
    startInteractivePoll(saved.sessionId)
  }, [startInteractivePoll])

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
      // Voice mode forces the kody-direct backend + `kody-speech` system
      // prompt regardless of the dropdown selection. The user picks an
      // agent for text; the mic always speaks via Gemini.
      const response = await sendText(transcript, [], { voiceMode: true })
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

  // Belt-and-suspenders cleanup: every code path that closes the voice
  // overlay should already call stopConversation, but if any future
  // close path forgets (or a streamed reply lands AFTER the user
  // closes), we still want speech + recognition to shut down. Driving
  // it off voiceOverlayOpen guarantees no orphan TTS keeps narrating
  // once the window is gone.
  useEffect(() => {
    if (voiceOverlayOpen) return
    voiceChatRef.current?.stopConversation()
  }, [voiceOverlayOpen])

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

  // Kody Live blocks the input until the runner is ready. Other agents
  // are unaffected — only the explicit warm-up flow uses this gate.
  const isKodyLive = selectedAgentId === 'kody-live'
  const liveLocked = isKodyLive && interactiveState !== 'ready'

  // Generate placeholder based on mode
  const placeholder = isKodyLive
    ? interactiveState === 'idle' || interactiveState === 'ended'
      ? 'Click "Start Live Runner" above to warm up the runner...'
      : interactiveState === 'booting'
        ? 'Booting runner... ~90s'
        : 'Ask Kody (live runner)...'
    : isKodyWaiting
      ? `Give Kody instructions...`
      : isTaskMode
        ? `Ask about task #${selectedTask?.issueNumber}...`
        : isJobMode
          ? `Ask about job \`${selectedJob?.slug ?? ''}\`...`
          : isDraftMode
            ? `Describe the job you want Kody to run...`
            : `Ask Kody...`

  const canSend = (input.trim() || attachments.length > 0) && !liveLocked

  return (
    <div
      className="relative flex flex-col h-full md:border-l bg-background"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay — visible while a file is being dragged over the chat */}
      {isDraggingFile && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-md backdrop-blur-sm">
          <div className="px-4 py-3 bg-background/90 rounded-lg shadow-lg text-base font-medium text-primary">
            Drop to attach
          </div>
        </div>
      )}
      {/* Session Sidebar */}
      {showSessionSidebar && isGlobalMode && (
        <SessionSidebar
          sessions={sessionHook.sessions}
          activeSessionId={sessionHook.activeSession?.id || null}
          onSwitchSession={sessionHook.switchSession}
          onCreateSession={sessionHook.createSession}
          onDeleteSession={sessionHook.deleteSession}
          onRenameSession={sessionHook.renameSession}
          onPinSession={sessionHook.pinSession}
          onClose={() => setShowSessionSidebar(false)}
          className="absolute left-0 top-0 bottom-0 w-full sm:w-72 z-50 shadow-lg"
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
      <div className="px-2 py-1.5 sm:px-4 sm:py-3 border-b bg-gradient-to-r from-muted/80 to-muted/40">
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
              {(() => {
                const Icon = currentAgent.icon
                return <Icon className="w-5 h-5" aria-label={currentAgent.name} />
              })()}
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
                      {(() => {
                        const Icon = a.icon
                        return <Icon className="w-4 h-4 mt-0.5" aria-hidden="true" />
                      })()}
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
            {/* New chat — visible in job + draft modes (global has its own
                Chats sidebar; task mode persists to the task). Clears the
                active scope's ephemeral buffer so the user can start over. */}
            {(isJobMode || isDraftMode || isPlannerMode) && messages.length > 0 && (
              <button
                onClick={() => {
                  setMessages([])
                  setToolCalls([])
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-transparent text-muted-foreground hover:text-foreground hover:bg-background hover:border-border transition-all"
                title="Start a fresh chat in this scope"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">New chat</span>
              </button>
            )}

            {/* Session sidebar toggle (global mode only) */}
            {isGlobalMode && (
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

            {/* Close (mobile sheet) — only when an onClose handler is provided */}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close chat"
                title="Close"
                className="ml-1 p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-background border border-transparent hover:border-border transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Context bar: task, job, job draft, or global */}
        <div className="mt-1 sm:mt-2">
          {isTaskMode && selectedTask ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="px-1.5 py-0.5 bg-primary text-primary-foreground rounded font-medium">
                #{selectedTask.issueNumber}
              </span>
              <span className="truncate text-muted-foreground">{selectedTask.title}</span>
            </div>
          ) : isJobMode && selectedJob ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="px-1.5 py-0.5 bg-emerald-500/15 text-emerald-400 rounded font-medium inline-flex items-center gap-1">
                <Target className="w-3 h-3" />{selectedJob.slug}
              </span>
              <span className="truncate text-muted-foreground">{selectedJob.title}</span>
            </div>
          ) : isDraftMode ? (
            <div className="text-sm text-emerald-400 flex items-center gap-1.5">
              <Target className="w-3 h-3" />
              Drafting a new job
            </div>
          ) : isPlannerMode && plannerGoal ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="px-1.5 py-0.5 bg-sky-500/15 text-sky-400 rounded font-medium inline-flex items-center gap-1">
                Planning
              </span>
              <span className="truncate text-muted-foreground flex-1 min-w-0">
                {plannerGoal.name}
              </span>
              {onPlannerExit ? (
                <button
                  type="button"
                  onClick={onPlannerExit}
                  className="shrink-0 text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-accent"
                  aria-label="Stop planning this goal"
                  title="Stop planning"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : null}
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
      <div className="flex-1 overflow-auto px-1.5 py-2 sm:p-4 space-y-4">
        {messages.length === 0 && !loading && !isLoadingTaskChat && (
          <div className="text-center text-muted-foreground text-base py-8">
            {isTaskMode ? (
              <>
                <p className="font-medium">Chat about this task</p>
                <p className="text-sm mt-1">Messages will be saved to the task</p>
                <p className="text-sm mt-3 font-medium text-foreground">I can help you:</p>
                <ul className="mt-2 text-left text-sm space-y-2 max-w-sm mx-auto">
                  <li className="flex items-start gap-2">
                    <span className="text-primary">•</span>
                    <span>
                      Diagnose the linked PR if it didn&apos;t fully fix the issue —
                      try{' '}
                      <span className="font-mono">
                        &quot;diagnose {selectedTask?.associatedPR ? `PR #${selectedTask.associatedPR.number}` : 'this PR'}&quot;
                      </span>
                      . I&apos;ll read the diff, find the gap, and draft a sharper{' '}
                      <span className="font-mono">@kody fix</span> for your approval.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary">•</span>
                    <span>Explain the issue, the PR diff, or pipeline status</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary">•</span>
                    <span>Browse and search the repository for related code</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary">•</span>
                    <span>Draft a follow-up <span className="font-mono">@kody</span> instruction</span>
                  </li>
                </ul>
              </>
            ) : isJobMode && selectedJob ? (
              <>
                <p className="font-medium text-foreground">
                  Chat about `{selectedJob.slug}`
                </p>
                <p className="text-sm mt-1 max-w-sm mx-auto">
                  Ask anything about this job&apos;s intent, scope, or rules.
                  Each job has its own thread.
                </p>
              </>
            ) : isDraftMode ? (
              <>
                <p className="font-medium text-foreground">Let&apos;s plan a new job</p>
                <p className="text-sm mt-1">
                  Describe what you want Kody to do. I&apos;ll help scope the intent,
                  allowed commands, and restrictions. When a draft looks good, pick
                  <span className="font-medium"> Use as job</span> to turn it
                  into a real job.
                </p>
              </>
            ) : isPlannerMode && plannerGoal ? (
              <>
                <p className="font-medium text-foreground">
                  Plan tasks for &ldquo;{plannerGoal.name}&rdquo;
                </p>
                <p className="text-sm mt-1 max-w-md mx-auto">
                  Say <span className="font-mono">&quot;plan it&quot;</span> (or
                  paste extra context first). I&apos;ll propose a task list, you
                  approve, then I&apos;ll deepen each spec and create the issues
                  attached to this goal.
                </p>
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
                  <li className="flex items-start gap-2">
                    <span className="text-primary">•</span>
                    <span>
                      Diagnose a Kody PR that didn&apos;t fully solve its issue —
                      try <span className="font-mono">&quot;diagnose PR #1404&quot;</span>
                    </span>
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
            data-role={msg.role}
            className={`group flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} relative`}
          >
            <div
              className={`max-w-[92%] sm:max-w-[85%] min-w-0 break-words rounded-lg px-3 py-2 text-[17px] leading-relaxed ${
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
                    (() => {
                      const { reasoning, answer } = parseReasoning(msg.content)
                      return (
                        <>
                          {reasoning && (
                            <ReasoningPanel
                              content={reasoning}
                              isStreaming={!!msg.isLoading}
                            />
                          )}
                          <div className="prose prose-base dark:prose-invert max-w-none break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_code]:break-words">
                            <ReactMarkdown>{answer}</ReactMarkdown>
                          </div>
                        </>
                      )
                    })()
                  )}
                  {/* Draft-mode finalize action: hand this assistant reply back
                      to the caller (JobControl) as the body of a new
                      job. Hidden while the reply is still streaming in. */}
                  {isDraftMode &&
                    onFinalizeDraft &&
                    !msg.isLoading &&
                    msg.content.trim().length > 0 && (
                      <button
                        type="button"
                        onClick={() => onFinalizeDraft(msg.content)}
                        className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                        title="Use this response as the body of a new job"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Use as job
                      </button>
                    )}
                </>
              ) : (
                <>
                  {msg.attachments && msg.attachments.length > 0 && (
                    <MessageAttachments attachments={msg.attachments} />
                  )}
                  {msg.content}
                </>
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
            <div className="max-w-[92%] sm:max-w-[85%] rounded-lg px-3 py-2 bg-muted">
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
        <div className="px-2 sm:px-3 pb-2 flex flex-wrap gap-2">
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
      <div className="px-1.5 py-2 sm:p-3 border-t">
        {/* Kody Live warm-up banner — only visible when the live agent is
            selected and the runner isn't currently ready to accept messages. */}
        {isKodyLive && interactiveState !== 'ready' ? (
          <div
            className={`mb-2 flex items-center justify-between gap-2 rounded-md border p-2 text-sm ${
              interactiveState === 'booting'
                ? 'border-yellow-500/50 bg-yellow-500/10 text-yellow-900 dark:text-yellow-100'
                : 'border-border bg-muted/40'
            }`}
          >
            <div className="flex items-center gap-2">
              {interactiveState === 'booting' ? (
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
                    <span>
                      {bootPhaseLabel(bootElapsed)} · {formatElapsed(bootElapsed)} elapsed
                    </span>
                  </div>
                  {interactiveTarget ? (
                    <a
                      href={
                        interactiveRunUrl ??
                        `https://github.com/${interactiveTarget.owner}/${interactiveTarget.repo}/actions/workflows/kody.yml`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-yellow-700 underline hover:text-yellow-900 dark:text-yellow-300 dark:hover:text-yellow-100"
                    >
                      {interactiveRunUrl
                        ? `Watching ${interactiveTarget.owner}/${interactiveTarget.repo} → run ↗`
                        : `Watching ${interactiveTarget.owner}/${interactiveTarget.repo} → Actions ↗`}
                    </a>
                  ) : null}
                </div>
              ) : interactiveState === 'ended' ? (
                <span className="text-muted-foreground">Live runner ended. Start a new session to chat.</span>
              ) : (
                <span className="text-muted-foreground">
                  Live runner is offline. Start it to enable chat.
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {interactiveState !== 'booting' ? (
                <button
                  type="button"
                  onClick={() => void startInteractiveSession()}
                  className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  {interactiveState === 'ended' ? 'Start new session' : 'Start Live Runner'}
                </button>
              ) : null}
              {interactiveState === 'booting' || interactiveState === 'ended' ? (
                <button
                  type="button"
                  onClick={endInteractiveSession}
                  className="rounded-md border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
                  title={
                    interactiveState === 'booting'
                      ? 'Abandon this boot attempt and reset. The GitHub runner will idle-exit on its own (~5min).'
                      : 'Clear this ended session and reset.'
                  }
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {isKodyLive && interactiveState === 'ready' ? (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-green-500/40 bg-green-500/10 p-2 text-xs text-green-900 dark:text-green-100">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                <span>Live runner ready. Chat normally — replies arrive via the long-lived workflow.</span>
              </div>
              {interactiveRunUrl || interactiveTarget ? (
                <a
                  href={
                    interactiveRunUrl ??
                    (interactiveTarget
                      ? `https://github.com/${interactiveTarget.owner}/${interactiveTarget.repo}/actions/workflows/kody.yml`
                      : '#')
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-green-800 underline hover:text-green-950 dark:text-green-200 dark:hover:text-green-50"
                >
                  {interactiveRunUrl ? 'View run on GitHub ↗' : 'View workflow on GitHub ↗'}
                </a>
              ) : null}
            </div>
            <button
              type="button"
              onClick={endInteractiveSession}
              className="rounded-md border border-green-700/30 px-2 py-0.5 text-xs font-medium text-green-900 hover:bg-green-500/20 dark:text-green-100"
              title="End this live session. The runner will idle-exit on its own."
            >
              End session
            </button>
          </div>
        ) : null}
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
            className="flex-1 px-3 py-2 text-base rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={loading || liveLocked}
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
