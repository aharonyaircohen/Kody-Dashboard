'use client'
/**
 * @fileType hook
 * @domain kody
 * @pattern notification-system
 * @ai-summary localStorage-backed notification history (max 50) with read/unread tracking
 */

import { useState, useCallback, useEffect } from 'react'
import type { KodyNotification, NotificationPrefs, NotificationType } from './types'
import { DEFAULT_PREFS, NOTIFICATION_META } from './types'

const STORAGE_KEY = 'kody-notifications'
const PREFS_KEY = 'kody-notification-prefs'
const MAX_NOTIFICATIONS = 50

function loadNotifications(): KodyNotification[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as KodyNotification[]) : []
  } catch {
    return []
  }
}

function saveNotifications(items: KodyNotification[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_NOTIFICATIONS)))
  } catch {
    /* storage full */
  }
}

function loadPrefs(): NotificationPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw
      ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<NotificationPrefs>) }
      : DEFAULT_PREFS
  } catch {
    return DEFAULT_PREFS
  }
}

function savePrefs(prefs: NotificationPrefs): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* storage full */
  }
}

export interface UseNotificationStoreReturn {
  notifications: KodyNotification[]
  unreadCount: number
  prefs: NotificationPrefs
  /** Add a new notification. Returns false if the type is disabled. */
  addNotification: (
    type: NotificationType,
    title: string,
    body: string,
    opts?: {
      taskIssueNumber?: number
      taskTitle?: string
      meta?: Record<string, string>
    },
  ) => KodyNotification | null
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  clearAll: () => void
  removeNotification: (id: string) => void
  updatePrefs: (patch: Partial<NotificationPrefs>) => void
  toggleType: (type: NotificationType) => void
  isTypeEnabled: (type: NotificationType) => boolean
}

export function useNotificationStore(): UseNotificationStoreReturn {
  const [notifications, setNotifications] = useState<KodyNotification[]>([])
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS)

  // Load from localStorage on mount
  useEffect(() => {
    setNotifications(loadNotifications())
    setPrefs(loadPrefs())
  }, [])

  const unreadCount = notifications.filter((n) => !n.read).length

  const isTypeEnabled = useCallback(
    (type: NotificationType) => !prefs.disabledTypes.includes(type),
    [prefs.disabledTypes],
  )

  const addNotification = useCallback(
    (
      type: NotificationType,
      title: string,
      body: string,
      opts?: { taskIssueNumber?: number; taskTitle?: string; meta?: Record<string, string> },
    ): KodyNotification | null => {
      if (prefs.disabledTypes.includes(type)) return null
      if (!prefs.inAppEnabled) return null

      const meta = NOTIFICATION_META[type]
      const notification: KodyNotification = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        title: `${meta.icon} ${title}`,
        body,
        timestamp: new Date().toISOString(),
        read: false,
        taskIssueNumber: opts?.taskIssueNumber,
        taskTitle: opts?.taskTitle,
        meta: opts?.meta,
      }

      setNotifications((prev) => {
        const next = [notification, ...prev].slice(0, MAX_NOTIFICATIONS)
        saveNotifications(next)
        return next
      })

      return notification
    },
    [prefs.disabledTypes, prefs.inAppEnabled],
  )

  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      saveNotifications(next)
      return next
    })
  }, [])

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, read: true }))
      saveNotifications(next)
      return next
    })
  }, [])

  const clearAll = useCallback(() => {
    setNotifications([])
    saveNotifications([])
  }, [])

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => {
      const next = prev.filter((n) => n.id !== id)
      saveNotifications(next)
      return next
    })
  }, [])

  const updatePrefs = useCallback((patch: Partial<NotificationPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      savePrefs(next)
      return next
    })
  }, [])

  const toggleType = useCallback((type: NotificationType) => {
    setPrefs((prev) => {
      const disabled = prev.disabledTypes.includes(type)
        ? prev.disabledTypes.filter((t) => t !== type)
        : [...prev.disabledTypes, type]
      const next = { ...prev, disabledTypes: disabled }
      savePrefs(next)
      return next
    })
  }, [])

  return {
    notifications,
    unreadCount,
    prefs,
    addNotification,
    markAsRead,
    markAllAsRead,
    clearAll,
    removeNotification,
    updatePrefs,
    toggleType,
    isTypeEnabled,
  }
}
