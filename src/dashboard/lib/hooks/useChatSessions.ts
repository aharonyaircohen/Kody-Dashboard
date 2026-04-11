/**
 * @fileType hook
 * @domain kody
 * @pattern session-management
 * @ai-summary Session management hook for Kody global chat - CRUD operations with localStorage persistence
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createEmptyGlobalStore } from '../chat-types'
import type { ChatMessage, GlobalChatStore, SessionMeta } from '../chat-types'

const STORAGE_KEY = 'kody-sessions-v3'
const MAX_SESSIONS = 50
const DEBOUNCE_MS = 1000

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Migrate v2 store (agent-scoped) to v3 store (single session).
 * Sessions from all agents are merged — agentId field is dropped.
 */
function migrateFromV2(v2Data: GlobalChatStore | null): GlobalChatStore {
  const store: GlobalChatStore = {
    version: 3,
    sessions: [],
    messages: {},
    activeSessionId: '',
  }

  if (!v2Data) return store

  // Migrate sessions (drop agentId which no longer exists)
  for (const session of v2Data.sessions) {
    store.sessions.push({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messageCount,
      pinned: session.pinned,
    })
    store.messages[session.id] = (v2Data.messages as Record<string, import('../chat-types').ChatMessage[]>)[session.id] || []
  }

  // Pick any non-empty active session as the new active
  if (v2Data.activeSessionId && typeof v2Data.activeSessionId === 'object') {
    const activeIds = Object.values(v2Data.activeSessionId) as string[]
    store.activeSessionId = activeIds.find((id) => id && store.messages[id]?.length > 0) || ''
  }

  return store
}

/**
 * Load data from localStorage with migration support
 */
function loadStore(): GlobalChatStore {
  if (typeof window === 'undefined') {
    return createEmptyGlobalStore()
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as GlobalChatStore
      if (parsed.version === 3) return parsed
      // Migrate older versions
      if (parsed.version === 2) {
        const migrated = migrateFromV2(parsed)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
        return migrated
      }
    }
  } catch (error) {
    console.error('Failed to load chat sessions:', error)
  }

  return createEmptyGlobalStore()
}

/**
 * Save data to localStorage (debounced)
 */
let saveTimeout: ReturnType<typeof setTimeout> | null = null

function saveStore(store: GlobalChatStore): void {
  if (typeof window === 'undefined') return

  if (saveTimeout) clearTimeout(saveTimeout)

  saveTimeout = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
    } catch (error) {
      console.error('Failed to save chat sessions:', error)
    }
  }, DEBOUNCE_MS)
}

export interface UseChatSessionsResult {
  /** All sessions, sorted by updatedAt descending */
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
 * Hook for managing chat sessions.
 */
export function useChatSessions(): UseChatSessionsResult {
  const [store, setStore] = useState<GlobalChatStore | null>(null)

  // Load on mount (client-side only)
  useEffect(() => {
    setStore(loadStore())
  }, [])

  // Get sessions sorted by updatedAt descending
  const sessions = useMemo(() => {
    if (!store) return []
    return [...store.sessions].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
  }, [store])

  // Get active session
  const activeSession = useMemo(() => {
    if (!store || !store.activeSessionId) return null
    return store.sessions.find((s) => s.id === store.activeSessionId) || null
  }, [store])

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
      title: 'New conversation',
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      pinned: false,
    }

    setStore((prev) => {
      if (!prev) return prev

      // Enforce session limit - delete oldest non-pinned session
      if (prev.sessions.length >= MAX_SESSIONS) {
        const nonPinned = prev.sessions
          .filter((s) => !s.pinned)
          .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())

        if (nonPinned.length > 0) {
          const oldestId = nonPinned[0].id
          const updatedSessions = prev.sessions.filter((s) => s.id !== oldestId)
          const { [oldestId]: _, ...restMessages } = prev.messages
          const newStore: GlobalChatStore = {
            ...prev,
            sessions: updatedSessions,
            messages: restMessages,
            activeSessionId: sessionId,
          }
          const withNew = {
            ...newStore,
            sessions: [...newStore.sessions, newSession],
            messages: { ...newStore.messages, [sessionId]: [] },
          }
          saveStore(withNew)
          return withNew
        }
      }

      const newStore: GlobalChatStore = {
        ...prev,
        sessions: [...prev.sessions, newSession],
        messages: { ...prev.messages, [sessionId]: [] },
        activeSessionId: sessionId,
      }
      saveStore(newStore)
      return newStore
    })

    return sessionId
  }, [])

  // Switch to a different session
  const switchSession = useCallback((sessionId: string) => {
    setStore((prev) => {
      if (!prev) return prev
      const newStore: GlobalChatStore = { ...prev, activeSessionId: sessionId }
      saveStore(newStore)
      return newStore
    })
  }, [])

  // Rename a session
  const renameSession = useCallback((sessionId: string, title: string) => {
    setStore((prev) => {
      if (!prev) return prev
      const newStore: GlobalChatStore = {
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
  const deleteSession = useCallback((sessionId: string) => {
    setStore((prev) => {
      if (!prev) return prev

      const wasActive = prev.activeSessionId === sessionId
      const newSessions = prev.sessions.filter((s) => s.id !== sessionId)
      const { [sessionId]: _, ...restMessages } = prev.messages

      // If was active, switch to most recent remaining session
      const newActiveId = wasActive
        ? [...newSessions].sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          )[0]?.id || ''
        : prev.activeSessionId

      const newStore: GlobalChatStore = {
        ...prev,
        sessions: newSessions,
        messages: restMessages,
        activeSessionId: newActiveId,
      }
      saveStore(newStore)
      return newStore
    })
  }, [])

  // Pin/unpin a session
  const pinSession = useCallback((sessionId: string) => {
    setStore((prev) => {
      if (!prev) return prev
      const newStore: GlobalChatStore = {
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
      const newStore: GlobalChatStore = {
        ...prev,
        messages: { ...prev.messages, [activeSession.id]: [] },
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

        const newStore: GlobalChatStore = {
          ...prev,
          messages: { ...prev.messages, [activeSession.id]: newMessages },
          sessions: prev.sessions.map((s) =>
            s.id === activeSession.id
              ? {
                  ...s,
                  messageCount: newMessages.length,
                  updatedAt: new Date().toISOString(),
                  title:
                    s.title === 'New conversation' && newMessages.length > 0
                      ? newMessages.find((m: ChatMessage) => m.role === 'user')?.text?.slice(0, 60) ||
                        s.title
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
