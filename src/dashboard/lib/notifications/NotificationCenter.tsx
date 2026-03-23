'use client'
/**
 * @fileType component
 * @domain kody
 * @pattern notification-system
 * @ai-summary Dropdown notification center with unread badge, history, and preferences
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { Bell, Check, CheckCheck, Trash2, Settings, X } from 'lucide-react'
import { cn } from '@dashboard/lib/utils/ui'
import type { UseNotificationStoreReturn } from './useNotificationStore'
import { NOTIFICATION_META } from './types'
import type { NotificationType } from './types'
import { NotificationPreferences } from './NotificationPreferences'

interface NotificationCenterProps {
  store: UseNotificationStoreReturn
  browserPermission: NotificationPermission
  isSupported: boolean
  onRequestPermission: () => void
}

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function NotificationCenter({
  store,
  browserPermission,
  isSupported,
  onRequestPermission,
}: NotificationCenterProps) {
  const [open, setOpen] = useState(false)
  const [showPrefs, setShowPrefs] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
        setShowPrefs(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        setOpen(false)
        setShowPrefs(false)
      }
    },
    [open],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const { notifications, unreadCount, markAsRead, markAllAsRead, clearAll, removeNotification } =
    store

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button with unread badge */}
      <button
        type="button"
        onClick={() => {
          setOpen(!open)
          setShowPrefs(false)
        }}
        className={cn(
          'relative p-1.5 rounded-md transition-colors',
          open
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted',
        )}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold text-destructive-foreground bg-destructive rounded-full">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-background border rounded-lg shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <span className="text-sm font-semibold">Notifications</span>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllAsRead}
                  className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
                  title="Mark all as read"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors"
                  title="Clear all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowPrefs(!showPrefs)}
                className={cn(
                  'p-1 rounded transition-colors',
                  showPrefs
                    ? 'text-primary bg-primary/10'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                title="Notification settings"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Preferences panel (slide-in) */}
          {showPrefs ? (
            <NotificationPreferences
              store={store}
              browserPermission={browserPermission}
              isSupported={isSupported}
              onRequestPermission={onRequestPermission}
              onClose={() => setShowPrefs(false)}
            />
          ) : (
            <>
              {/* Browser permission banner */}
              {isSupported && browserPermission !== 'granted' && (
                <div className="px-3 py-2 bg-amber-500/10 border-b text-xs">
                  <button
                    type="button"
                    onClick={onRequestPermission}
                    className="text-amber-600 dark:text-amber-400 hover:underline"
                  >
                    {browserPermission === 'denied'
                      ? '⚠️ Browser notifications blocked — check browser settings'
                      : '🔔 Enable browser notifications for background alerts'}
                  </button>
                </div>
              )}

              {/* Notification list */}
              <div className="max-h-[400px] overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p>No notifications yet</p>
                    <p className="text-xs mt-1">Task updates will appear here</p>
                  </div>
                ) : (
                  notifications.map((notif) => {
                    const meta = NOTIFICATION_META[notif.type as NotificationType]
                    return (
                      <div
                        key={notif.id}
                        className={cn(
                          'flex items-start gap-2 px-3 py-2.5 border-b last:border-b-0 transition-colors cursor-pointer hover:bg-muted/50',
                          !notif.read && 'bg-primary/5',
                        )}
                        onClick={() => markAsRead(notif.id)}
                      >
                        {/* Icon */}
                        <span className="text-base mt-0.5 shrink-0">{meta?.icon ?? '📌'}</span>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <p
                              className={cn(
                                'text-xs font-medium truncate',
                                !notif.read && 'text-foreground',
                                notif.read && 'text-muted-foreground',
                              )}
                            >
                              {notif.title.replace(/^[^\s]+ /, '')}
                            </p>
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {timeAgo(notif.timestamp)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {notif.body}
                          </p>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-0.5 shrink-0">
                          {!notif.read && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                markAsRead(notif.id)
                              }}
                              className="p-0.5 text-muted-foreground hover:text-primary rounded"
                              title="Mark as read"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              removeNotification(notif.id)
                            }}
                            className="p-0.5 text-muted-foreground hover:text-destructive rounded"
                            title="Remove"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
