/**
 * @fileType hook
 * @domain kody
 * @pattern session-management
 * @ai-summary Session management hook for Kody global chat - CRUD operations with localStorage persistence
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import type { AgentId } from '../agents'
import type { ChatMessage, GlobalChatStore, SessionMeta } from '../chat-types'

const STORAGE_KEY = 'kody-sessions-v2'
const MAX_SESSIONS_PER_AGENT = 50
const DEBOUNCE_MS = 1000

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Convert legacy v1 format (Record<AgentId, Message[]>) to v2 format
 */
function migrateFromV1(v1Data: Record<AgentId, ChatMessage[]> | null): GlobalChatStore {
  if (!v1Data) {
    return {
      version: 2,
      sessions: [],
      messages: {},
      activeSessionId: {
        'dashboard-manager': '',
        'prd-refiner': '',
        'system-architect': '',
      },
    }
  }

  const store: GlobalChatStore = {
    version: 2,
    sessions: [],
    messages: {},
    activeSessionId: {
      'dashboard-manager': '',
      'prd-refiner': '',
      'system-architect': '',
    },
  }

  // Migrate each agent's messages to a session
  const now = new Date().toISOString()
  for (const agentId of Object.keys(v1Data) as AgentId[]) {
    const messages = v1Data[agentId]
    if (messages && messages.length > 0) {
      const sessionId = generateSessionId()
      const firstUserMessage = messages.find((m) => m.role === 'user')
      const title = firstUserMessage?.text?.slice(0, 60) || 'Imported conversation'

      store.sessions.push({
        id: sessionId,
        agentId,
        title,
        createdAt: now,
        updatedAt: now,
        messageCount: messages.length,
        pinned: false,
      })

      store.messages[sessionId] = messages
      store.activeSessionId[agentId] = sessionId
    }
  }

  return store
}

/**
 * Load data from localStorage with migration support
 */
function loadStore(): GlobalChatStore {
  if (typeof window === 'undefined') {
    return {
      version: 2,
      sessions: [],
      messages: {},
      activeSessionId: {
        'dashboard-manager': '',
        'prd-refiner': '',
        'system-architect': '',
      },
    }
  }

  try {
    // Try to load v2 format
    const v2Data = localStorage.getItem(STORAGE_KEY)
    if (v2Data) {
      const parsed = JSON.parse(v2Data) as GlobalChatStore
      if (parsed.version === 2) {
        return parsed
      }
    }

    // Try to load legacy v1 format
    const v1Data = localStorage.getItem('kody-global-chat')
    if (v1Data) {
      const parsed = JSON.parse(v1Data)
      const migrated = migrateFromV1(parsed)
      // Save migrated data
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
      // Remove legacy key
      localStorage.removeItem('kody-global-chat')
      return migrated
    }
  } catch (error) {
    console.error('Failed to load chat sessions:', error)
  }

  return {
    version: 2,
    sessions: [],
    messages: {},
    activeSessionId: {
      'dashboard-manager': '',
      'prd-refiner': '',
      'system-architect': '',
    },
  }
}

/**
 * Save data to localStorage (debounced)
 */
let saveTimeout: ReturnType<typeof setTimeout> | null = null

function saveStore(store: GlobalChatStore): void {
  if (typeof window === 'undefined') return

  if (saveTimeout) {
    clearTimeout(saveTimeout)
  }

  saveTimeout = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
    } catch (error) {
      console.error('Failed to save chat sessions:', error)
    }
  }, DEBOUNCE_MS)
}

export interface UseChatSessionsResult {
  /** All sessions for the current agent */
  sessions: SessionMeta[]
  /** The currently active session */
  activeSession: SessionMeta | null
  /** Messages in the active session */
  messages: ChatMessage[]
  /** Set messages directly */
  setMessages: (msgs: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void
  /** Create a new session */
  createSession: () => string
  /** Switch to a different session */
  switchSession: (sessionId: string) => void
  /** Rename a session */
  renameSession: (sessionId: string, title: string) => void
  /** Delete a session */
  deleteSession: (sessionId: string) => void
  /** Pin/unpin a session */
  pinSession: (sessionId: string) => void
  /** Clear messages in the active session */
  clearActiveSession: () => void
}

/**
 * Hook for managing chat sessions for a specific agent
 */
export function useChatSessions(agentId: AgentId): UseChatSessionsResult {
  const [store, setStore] = useState<GlobalChatStore | null>(null)

  // Load on mount (client-side only)
  useEffect(() => {
    setStore(loadStore())
  }, [])

  // Get sessions for this agent, sorted by updatedAt descending
  const sessions = useMemo(() => {
    if (!store) return []
    return store.sessions
      .filter((s) => s.agentId === agentId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [store, agentId])

  // Get active session
  const activeSession = useMemo(() => {
    if (!store || !store.activeSessionId[agentId]) return null
    return store.sessions.find((s) => s.id === store.activeSessionId[agentId]) || null
  }, [store, agentId])

  // Get messages for active session
  const messages = useMemo(() => {
    if (!store || !activeSession) return []
    return store.messages[activeSession.id] || []
  }, [store, activeSession])

  // Create a new session
  const createSession = useCallback(() => {
    const now = new Date().toISOString()
    const sessionId = generateSessionId()
    const newSession: SessionMeta = {
      id: sessionId,
      agentId,
      title: 'New conversation',
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      pinned: false,
    }

    setStore((prev) => {
      if (!prev) return prev

      const agentSessions = prev.sessions.filter((s) => s.agentId === agentId)

      // Enforce session limit - delete oldest non-pinned session
      let updatedSessions = prev.sessions
      if (agentSessions.length >= MAX_SESSIONS_PER_AGENT) {
        const nonPinned = agentSessions
          .filter((s) => !s.pinned)
          .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
        if (nonPinned.length > 0) {
          const oldestId = nonPinned[0].id
          updatedSessions = prev.sessions.filter((s) => s.id !== oldestId)
          const { [oldestId]: _, ...restMessages } = prev.messages
          const newStore = {
            ...prev,
            sessions: updatedSessions,
            messages: restMessages,
          }
          saveStore(newStore)
          return newStore
        }
      }

      const newStore = {
        ...prev,
        sessions: [...prev.sessions, newSession],
        messages: { ...prev.messages, [sessionId]: [] },
        activeSessionId: { ...prev.activeSessionId, [agentId]: sessionId },
      }
      saveStore(newStore)
      return newStore
    })

    return sessionId
  }, [agentId])

  // Switch to a different session
  const switchSession = useCallback(
    (sessionId: string) => {
      setStore((prev) => {
        if (!prev) return prev
        const newStore = {
          ...prev,
          activeSessionId: { ...prev.activeSessionId, [agentId]: sessionId },
        }
        saveStore(newStore)
        return newStore
      })
    },
    [agentId],
  )

  // Rename a session
  const renameSession = useCallback((sessionId: string, title: string) => {
    setStore((prev) => {
      if (!prev) return prev
      const newStore = {
        ...prev,
        sessions: prev.sessions.map((s) =>
          s.id === sessionId ? { ...s, title, updatedAt: new Date().toISOString() } : s,
        ),
      }
      saveStore(newStore)
      return newStore
    })
  }, [])

  // Delete a session
  const deleteSession = useCallback(
    (sessionId: string) => {
      setStore((prev) => {
        if (!prev) return prev

        const wasActive = prev.activeSessionId[agentId] === sessionId

        // Remove session from list
        const newSessions = prev.sessions.filter((s) => s.id !== sessionId)

        // Remove messages
        const { [sessionId]: _, ...restMessages } = prev.messages

        // If was active, switch to most recent session
        let newActiveId = prev.activeSessionId[agentId]
        if (wasActive) {
          const remainingForAgent = newSessions
            .filter((s) => s.agentId === agentId)
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          newActiveId = remainingForAgent[0]?.id || ''
        }

        const newStore = {
          ...prev,
          sessions: newSessions,
          messages: restMessages,
          activeSessionId: { ...prev.activeSessionId, [agentId]: newActiveId },
        }
        saveStore(newStore)
        return newStore
      })
    },
    [agentId],
  )

  // Pin/unpin a session
  const pinSession = useCallback((sessionId: string) => {
    setStore((prev) => {
      if (!prev) return prev
      const newStore = {
        ...prev,
        sessions: prev.sessions.map((s) =>
          s.id === sessionId ? { ...s, pinned: !s.pinned, updatedAt: new Date().toISOString() } : s,
        ),
      }
      saveStore(newStore)
      return newStore
    })
  }, [])

  // Clear messages in active session
  const clearActiveSession = useCallback(() => {
    if (!activeSession) return

    setStore((prev) => {
      if (!prev) return prev
      const newStore = {
        ...prev,
        messages: {
          ...prev.messages,
          [activeSession.id]: [],
        },
        sessions: prev.sessions.map((s) =>
          s.id === activeSession.id
            ? { ...s, messageCount: 0, updatedAt: new Date().toISOString() }
            : s,
        ),
      }
      saveStore(newStore)
      return newStore
    })
  }, [activeSession])

  // Set messages (with auto-update of session metadata)
  const setMessages = useCallback(
    (newMessagesOrUpdater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      if (!activeSession) return

      setStore((prev) => {
        if (!prev) return prev

        const newMessages =
          typeof newMessagesOrUpdater === 'function'
            ? newMessagesOrUpdater(prev.messages[activeSession.id] || [])
            : newMessagesOrUpdater

        const newStore = {
          ...prev,
          messages: {
            ...prev.messages,
            [activeSession.id]: newMessages,
          },
          sessions: prev.sessions.map((s) =>
            s.id === activeSession.id
              ? {
                  ...s,
                  messageCount: newMessages.length,
                  updatedAt: new Date().toISOString(),
                  // Auto-title from first user message if still "New conversation"
                  title:
                    s.title === 'New conversation' && newMessages.length > 0
                      ? newMessages
                          .find((m: ChatMessage) => m.role === 'user')
                          ?.text?.slice(0, 60) || s.title
                      : s.title,
                }
              : s,
          ),
        }
        saveStore(newStore)
        return newStore
      })
    },
    [activeSession],
  )

  return {
    sessions,
    activeSession,
    messages,
    setMessages,
    createSession,
    switchSession,
    renameSession,
    deleteSession,
    pinSession,
    clearActiveSession,
  }
}
