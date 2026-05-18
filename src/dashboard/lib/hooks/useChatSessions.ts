/**
 * @fileType hook
 * @domain kody
 * @pattern session-management
 * @ai-summary Session management hook for Kody global chat - CRUD operations with localStorage persistence
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { createEmptyGlobalStore } from "../chat-types";
import type { ChatMessage, GlobalChatStore, SessionMeta } from "../chat-types";

const STORAGE_KEY_BASE = "kody-sessions-v3";
const LEGACY_UNSCOPED_KEY = "kody-sessions-v3";
const MAX_SESSIONS = 50;
const DEBOUNCE_MS = 1000;

/**
 * Logical "bucket" of sessions for the same repo. `'global'` is the
 * dashboard chat (and legacy data); other scopes get their own isolated
 * stores so e.g. the Vibe page's default (no-task) chat doesn't share
 * sessions with the dashboard.
 */
export type ChatSessionScope = "global" | "vibe-default";

/**
 * Last successfully-resolved per-repo key per scope. A genuine repo switch
 * reloads the page (see auth-context.tsx setCurrentRepo), which clears this
 * module state — so the only thing this guards against is a *transient*
 * `kody_auth` removal (token refresh / brief 401) within the same page life.
 * Without it, such a blip would silently redirect reads/writes to the
 * unscoped legacy key and could trigger legacy-key deletion in loadStore,
 * deleting the user's history mid-conversation.
 */
const lastKnownRepoKey = new Map<ChatSessionScope, string>();

/**
 * Compute the per-repo storage key from the connected repo in localStorage.kody_auth.
 * Falls back to the last resolved repo key when `kody_auth` is briefly absent,
 * and only to the unscoped legacy key when no repo has ever been seen.
 *
 * Repo switching reloads the page (see auth-context.tsx setCurrentRepo), so this
 * value is stable for a given (repo, scope) pair.
 */
function getStorageKey(scope: ChatSessionScope): string {
  const base =
    scope === "global" ? STORAGE_KEY_BASE : `${STORAGE_KEY_BASE}-${scope}`;
  const unscopedFallback = scope === "global" ? LEGACY_UNSCOPED_KEY : base;
  if (typeof window === "undefined") return unscopedFallback;
  const fallback = () => lastKnownRepoKey.get(scope) ?? unscopedFallback;
  try {
    const raw = window.localStorage.getItem("kody_auth");
    if (!raw) return fallback();
    const auth = JSON.parse(raw) as { owner?: string; repo?: string };
    if (!auth.owner || !auth.repo) return fallback();
    const key = `${base}:${auth.owner.toLowerCase()}/${auth.repo.toLowerCase()}`;
    lastKnownRepoKey.set(scope, key);
    return key;
  } catch {
    return fallback();
  }
}

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Derive a short, human-readable preview from the first non-empty user
 * message. Mirrors the slice fallback used by KodyChat's auto-title effect
 * so the sidebar label and the eventual offline title stay consistent.
 */
function derivePreview(messages: ChatMessage[]): string | undefined {
  const firstUser = messages.find(
    (m) => m.role === "user" && m.text.trim().length > 0,
  );
  if (!firstUser) return undefined;
  const raw = firstUser.text.trim().replace(/\s+/g, " ");
  if (raw.length === 0) return undefined;
  return raw.length > 48 ? `${raw.slice(0, 48).trim()}…` : raw;
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
    activeSessionId: "",
  };

  if (!v2Data) return store;

  // Migrate sessions (drop agentId which no longer exists)
  for (const session of v2Data.sessions) {
    store.sessions.push({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messageCount,
      pinned: session.pinned,
    });
    store.messages[session.id] =
      (
        v2Data.messages as Record<string, import("../chat-types").ChatMessage[]>
      )[session.id] || [];
  }

  // Pick any non-empty active session as the new active
  if (v2Data.activeSessionId && typeof v2Data.activeSessionId === "object") {
    const activeIds = Object.values(v2Data.activeSessionId) as string[];
    store.activeSessionId =
      activeIds.find((id) => id && store.messages[id]?.length > 0) || "";
  }

  return store;
}

/**
 * Load data from localStorage with migration support.
 *
 * One-time migration: if the legacy unscoped `kody-sessions-v3` key exists and
 * no per-repo key has been written yet for the current repo, adopt the legacy
 * blob under the current repo key and delete the legacy entry. This preserves
 * the user's existing chats for whichever repo they were last using.
 */
function loadStore(
  storageKey: string,
  scope: ChatSessionScope,
): GlobalChatStore {
  if (typeof window === "undefined") {
    return createEmptyGlobalStore();
  }

  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as GlobalChatStore;
      if (parsed.version === 3) return parsed;
      if (parsed.version === 2) {
        const migrated = migrateFromV2(parsed);
        localStorage.setItem(storageKey, JSON.stringify(migrated));
        return migrated;
      }
    }

    // Legacy unscoped-key adoption only applies to the global scope —
    // other scopes (e.g. vibe-default) start empty so they don't inherit
    // the dashboard's conversation history.
    if (scope === "global" && storageKey !== LEGACY_UNSCOPED_KEY) {
      const legacyRaw = localStorage.getItem(LEGACY_UNSCOPED_KEY);
      if (legacyRaw) {
        const legacyParsed = JSON.parse(legacyRaw) as GlobalChatStore;
        let adopted: GlobalChatStore | null = null;
        if (legacyParsed.version === 3) adopted = legacyParsed;
        else if (legacyParsed.version === 2)
          adopted = migrateFromV2(legacyParsed);
        if (adopted) {
          localStorage.setItem(storageKey, JSON.stringify(adopted));
          localStorage.removeItem(LEGACY_UNSCOPED_KEY);
          return adopted;
        }
      }
    }
  } catch (error) {
    console.error("Failed to load chat sessions:", error);
  }

  return createEmptyGlobalStore();
}

/**
 * Save data to localStorage (debounced, per storage key).
 *
 * The debounce timer and pending payload are keyed by `storageKey` — NOT
 * shared across all stores. Previously a single module-level timer meant a
 * pending save of the `global` chat could be cancelled by a save targeting
 * the (empty) `vibe-default` store after a scope swap, persisting a blank
 * store over real history. Per-key isolation makes that impossible.
 */
const saveTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const pendingSaves = new Map<string, string>();

function writePending(storageKey: string): void {
  const serialized = pendingSaves.get(storageKey);
  if (serialized === undefined) return;
  pendingSaves.delete(storageKey);
  try {
    localStorage.setItem(storageKey, serialized);
  } catch (error) {
    console.error("Failed to save chat sessions:", error);
  }
}

/**
 * Synchronously commit any debounced-but-unwritten save for a key. Called
 * before the hook loads a different scope/key so an in-flight write of real
 * history is never silently dropped by the scope swap.
 */
function flushSave(storageKey: string): void {
  const timeout = saveTimeouts.get(storageKey);
  if (timeout) {
    clearTimeout(timeout);
    saveTimeouts.delete(storageKey);
  }
  writePending(storageKey);
}

function saveStore(store: GlobalChatStore, storageKey: string): void {
  if (typeof window === "undefined") return;

  pendingSaves.set(storageKey, JSON.stringify(store));

  const existing = saveTimeouts.get(storageKey);
  if (existing) clearTimeout(existing);

  saveTimeouts.set(
    storageKey,
    setTimeout(() => {
      saveTimeouts.delete(storageKey);
      writePending(storageKey);
    }, DEBOUNCE_MS),
  );
}

export interface UseChatSessionsResult {
  /** All sessions, sorted by updatedAt descending */
  sessions: SessionMeta[];
  /** The currently active session */
  activeSession: SessionMeta | null;
  /** Messages in the active session */
  messages: ChatMessage[];
  /** Set messages directly */
  setMessages: (
    msgs: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
  ) => void;
  /** Create a new session */
  createSession: () => string;
  /** Switch to a different session */
  switchSession: (sessionId: string) => void;
  /** Rename a session */
  renameSession: (sessionId: string, title: string) => void;
  /** Delete a session */
  deleteSession: (sessionId: string) => void;
  /** Pin/unpin a session */
  pinSession: (sessionId: string) => void;
  /** Clear messages in the active session */
  clearActiveSession: () => void;
}

/**
 * Hook for managing chat sessions.
 *
 * `scope` defaults to `'global'` (the dashboard chat). Pass `'vibe-default'`
 * to isolate the Vibe page's no-task chat into its own store so it doesn't
 * share history with the dashboard.
 */
export function useChatSessions(
  scope: ChatSessionScope = "global",
): UseChatSessionsResult {
  const [store, setStore] = useState<GlobalChatStore | null>(null);
  // Re-derive when scope changes (e.g. Vibe selection clears → switch to
  // vibe-default bucket). Repo switching forces a full page reload, so we
  // only need to react to scope here.
  const storageKey = useMemo(() => getStorageKey(scope), [scope]);

  // Load on mount and whenever the storage key (i.e. scope) changes.
  // The cleanup runs with the *previous* key's closure, so a scope swap
  // flushes the old store's pending debounced save to disk before the new
  // (possibly empty) scope is loaded into state — otherwise that pending
  // write would be discarded and the conversation lost.
  useEffect(() => {
    setStore(loadStore(storageKey, scope));
    return () => {
      flushSave(storageKey);
    };
  }, [storageKey, scope]);

  // Get sessions sorted by updatedAt descending
  const sessions = useMemo(() => {
    if (!store) return [];
    return [...store.sessions].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [store]);

  // Get active session
  const activeSession = useMemo(() => {
    if (!store || !store.activeSessionId) return null;
    return store.sessions.find((s) => s.id === store.activeSessionId) || null;
  }, [store]);

  // Get messages for active session
  const messages = useMemo(() => {
    if (!store) return [];
    if (activeSession) return store.messages[activeSession.id] || [];
    // Defense-in-depth: activeSession is null only when activeSessionId
    // points at a session that doesn't exist in-memory (e.g. a stale-closure
    // createSession() created a phantom, or a spurious reload). Rather than
    // render an empty thread that "heals on refresh", fall back to the most
    // recently updated session so persisted history never silently vanishes.
    if (store.sessions.length > 0) {
      const recent = [...store.sessions].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )[0];
      return store.messages[recent.id] || [];
    }
    return [];
  }, [store, activeSession]);

  // Create a new session
  const createSession = useCallback(() => {
    const now = new Date().toISOString();
    const sessionId = generateSessionId();
    const newSession: SessionMeta = {
      id: sessionId,
      title: "New conversation",
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      pinned: false,
    };

    setStore((prev) => {
      if (!prev) return prev;

      // Enforce session limit - delete oldest non-pinned session
      if (prev.sessions.length >= MAX_SESSIONS) {
        const nonPinned = prev.sessions
          .filter((s) => !s.pinned)
          .sort(
            (a, b) =>
              new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
          );

        if (nonPinned.length > 0) {
          const oldestId = nonPinned[0].id;
          const updatedSessions = prev.sessions.filter(
            (s) => s.id !== oldestId,
          );
          const { [oldestId]: _, ...restMessages } = prev.messages;
          const newStore: GlobalChatStore = {
            ...prev,
            sessions: updatedSessions,
            messages: restMessages,
            activeSessionId: sessionId,
          };
          const withNew = {
            ...newStore,
            sessions: [...newStore.sessions, newSession],
            messages: { ...newStore.messages, [sessionId]: [] },
          };
          saveStore(withNew, storageKey);
          return withNew;
        }
      }

      const newStore: GlobalChatStore = {
        ...prev,
        sessions: [...prev.sessions, newSession],
        messages: { ...prev.messages, [sessionId]: [] },
        activeSessionId: sessionId,
      };
      saveStore(newStore, storageKey);
      return newStore;
    });

    return sessionId;
  }, [storageKey]);

  // Switch to a different session
  const switchSession = useCallback(
    (sessionId: string) => {
      setStore((prev) => {
        if (!prev) return prev;
        const newStore: GlobalChatStore = {
          ...prev,
          activeSessionId: sessionId,
        };
        saveStore(newStore, storageKey);
        return newStore;
      });
    },
    [storageKey],
  );

  // Rename a session
  const renameSession = useCallback(
    (sessionId: string, title: string) => {
      setStore((prev) => {
        if (!prev) return prev;
        const newStore: GlobalChatStore = {
          ...prev,
          sessions: prev.sessions.map((s) =>
            s.id === sessionId
              ? { ...s, title, updatedAt: new Date().toISOString() }
              : s,
          ),
        };
        saveStore(newStore, storageKey);
        return newStore;
      });
    },
    [storageKey],
  );

  // Delete a session
  const deleteSession = useCallback(
    (sessionId: string) => {
      setStore((prev) => {
        if (!prev) return prev;

        const wasActive = prev.activeSessionId === sessionId;
        const newSessions = prev.sessions.filter((s) => s.id !== sessionId);
        const { [sessionId]: _, ...restMessages } = prev.messages;

        // If was active, switch to most recent remaining session
        const newActiveId = wasActive
          ? [...newSessions].sort(
              (a, b) =>
                new Date(b.updatedAt).getTime() -
                new Date(a.updatedAt).getTime(),
            )[0]?.id || ""
          : prev.activeSessionId;

        const newStore: GlobalChatStore = {
          ...prev,
          sessions: newSessions,
          messages: restMessages,
          activeSessionId: newActiveId,
        };
        saveStore(newStore, storageKey);
        return newStore;
      });
    },
    [storageKey],
  );

  // Pin/unpin a session
  const pinSession = useCallback(
    (sessionId: string) => {
      setStore((prev) => {
        if (!prev) return prev;
        const newStore: GlobalChatStore = {
          ...prev,
          sessions: prev.sessions.map((s) =>
            s.id === sessionId
              ? { ...s, pinned: !s.pinned, updatedAt: new Date().toISOString() }
              : s,
          ),
        };
        saveStore(newStore, storageKey);
        return newStore;
      });
    },
    [storageKey],
  );

  // Clear messages in active session
  const clearActiveSession = useCallback(() => {
    if (!activeSession) return;

    setStore((prev) => {
      if (!prev) return prev;
      const newStore: GlobalChatStore = {
        ...prev,
        messages: { ...prev.messages, [activeSession.id]: [] },
        sessions: prev.sessions.map((s) =>
          s.id === activeSession.id
            ? { ...s, messageCount: 0, updatedAt: new Date().toISOString() }
            : s,
        ),
      };
      saveStore(newStore, storageKey);
      return newStore;
    });
  }, [activeSession, storageKey]);

  // Set messages (with auto-update of session metadata).
  // If no active session exists, auto-create one on the spot. This matters for
  // first-send flows in global mode — without this, the very first setMessages
  // call from the chat UI would silently no-op and nothing would ever render.
  const setMessages = useCallback(
    (
      newMessagesOrUpdater:
        | ChatMessage[]
        | ((prev: ChatMessage[]) => ChatMessage[]),
    ) => {
      setStore((prev) => {
        if (!prev) return prev;

        // Ensure an active session — create one if missing.
        let currentActiveId = prev.activeSessionId;
        let nextSessions = prev.sessions;
        let nextMessages = prev.messages;
        if (
          !currentActiveId ||
          !nextSessions.some((s) => s.id === currentActiveId)
        ) {
          const now = new Date().toISOString();
          const newId = generateSessionId();
          const newSession: SessionMeta = {
            id: newId,
            title: "New conversation",
            createdAt: now,
            updatedAt: now,
            messageCount: 0,
            pinned: false,
          };
          currentActiveId = newId;
          nextSessions = [...nextSessions, newSession];
          nextMessages = { ...nextMessages, [newId]: [] };
        }

        const computedNew =
          typeof newMessagesOrUpdater === "function"
            ? newMessagesOrUpdater(nextMessages[currentActiveId] || [])
            : newMessagesOrUpdater;

        const newStore: GlobalChatStore = {
          ...prev,
          activeSessionId: currentActiveId,
          messages: { ...nextMessages, [currentActiveId]: computedNew },
          // NOTE: title is intentionally left untouched here. Titling has
          // a single owner — the auto-title effect in KodyChat, which asks
          // the chat model for a real summary (slice is only its offline
          // fallback). Slicing here too would pre-empt that effect (it
          // only fires while the title is still "New conversation").
          sessions: nextSessions.map((s) =>
            s.id === currentActiveId
              ? {
                  ...s,
                  messageCount: computedNew.length,
                  updatedAt: new Date().toISOString(),
                  preview: derivePreview(computedNew) ?? s.preview,
                }
              : s,
          ),
        };
        saveStore(newStore, storageKey);
        return newStore;
      });
    },
    [storageKey],
  );

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
  };
}
