'use client'
/**
 * @fileType component
 * @domain kody
 * @pattern notification-system
 * @ai-summary Settings panel for notification preferences (per-type toggles, sound, browser)
 */

import { ArrowLeft, Volume2, VolumeX, Monitor, Bell } from 'lucide-react'
import { cn } from '@dashboard/lib/utils/ui'
import type { UseNotificationStoreReturn } from './useNotificationStore'
import { NOTIFICATION_META, type NotificationType } from './types'

interface NotificationPreferencesProps {
  store: UseNotificationStoreReturn
  browserPermission: NotificationPermission
  isSupported: boolean
  onRequestPermission: () => void
  onClose: () => void
}

const TYPE_ORDER: NotificationType[] = [
  'task-failed',
  'build-error',
  'gate-waiting',
  'task-assigned',
  'pr-ready',
  'task-completed',
  'pr-merged',
  'chat-response',
  'task-started',
  'stage-change',
  'retry-started',
]

export function NotificationPreferences({
  store,
  browserPermission,
  isSupported,
  onRequestPermission,
  onClose,
}: NotificationPreferencesProps) {
  const { prefs, updatePrefs, toggleType, isTypeEnabled } = store

  return (
    <div className="max-h-[400px] overflow-y-auto">
      {/* Back header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <button
          type="button"
          onClick={onClose}
          className="p-0.5 text-muted-foreground hover:text-foreground rounded"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-xs font-semibold">Notification Settings</span>
      </div>

      {/* Master toggles */}
      <div className="px-3 py-2 space-y-2 border-b">
        {/* In-app toggle */}
        <label className="flex items-center justify-between cursor-pointer">
          <span className="flex items-center gap-2 text-xs">
            <Bell className="w-3.5 h-3.5 text-muted-foreground" />
            In-app notifications
          </span>
          <input
            type="checkbox"
            checked={prefs.inAppEnabled}
            onChange={(e) => updatePrefs({ inAppEnabled: e.target.checked })}
            className="w-4 h-4 rounded border-border accent-primary"
          />
        </label>

        {/* Browser toggle */}
        <label className="flex items-center justify-between cursor-pointer">
          <span className="flex items-center gap-2 text-xs">
            <Monitor className="w-3.5 h-3.5 text-muted-foreground" />
            Browser notifications
          </span>
          {isSupported && browserPermission === 'granted' ? (
            <input
              type="checkbox"
              checked={prefs.browserEnabled}
              onChange={(e) => updatePrefs({ browserEnabled: e.target.checked })}
              className="w-4 h-4 rounded border-border accent-primary"
            />
          ) : (
            <button
              type="button"
              onClick={onRequestPermission}
              className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20"
            >
              {browserPermission === 'denied' ? 'Blocked' : 'Enable'}
            </button>
          )}
        </label>

        {/* Sound toggle */}
        <label className="flex items-center justify-between cursor-pointer">
          <span className="flex items-center gap-2 text-xs">
            {prefs.soundEnabled ? (
              <Volume2 className="w-3.5 h-3.5 text-muted-foreground" />
            ) : (
              <VolumeX className="w-3.5 h-3.5 text-muted-foreground" />
            )}
            Sound
          </span>
          <input
            type="checkbox"
            checked={prefs.soundEnabled}
            onChange={(e) => updatePrefs({ soundEnabled: e.target.checked })}
            className="w-4 h-4 rounded border-border accent-primary"
          />
        </label>
      </div>

      {/* Per-type toggles */}
      <div className="px-3 py-2">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Notification Types
        </p>
        <div className="space-y-1.5">
          {TYPE_ORDER.map((type) => {
            const meta = NOTIFICATION_META[type]
            const enabled = isTypeEnabled(type)
            return (
              <label key={type} className="flex items-center justify-between cursor-pointer py-0.5">
                <span className="flex items-center gap-2 text-xs">
                  <span>{meta.icon}</span>
                  <span className={cn(!enabled && 'text-muted-foreground')}>{meta.label}</span>
                  <span
                    className={cn(
                      'text-[9px] px-1 py-px rounded',
                      meta.priority === 'high' && 'bg-destructive/10 text-destructive',
                      meta.priority === 'medium' && 'bg-amber-500/10 text-amber-600',
                      meta.priority === 'low' && 'bg-muted text-muted-foreground',
                    )}
                  >
                    {meta.priority}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => toggleType(type)}
                  className="w-4 h-4 rounded border-border accent-primary"
                />
              </label>
            )
          })}
        </div>
      </div>
    </div>
  )
}
