/**
 * @fileType hooks
 * @domain kody
 * @pattern browser-notifications
 * @ai-summary Browser notification hook for task state changes.
 *   Detects column transitions, PR changes, stage changes, assignments.
 *   Delegates to notification store for in-app history and sound system for audio.
 */
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { KodyTask } from '../types'
import type { NotificationType } from '../notifications/types'
import { NOTIFICATION_META } from '../notifications/types'
import type { UseNotificationStoreReturn } from '../notifications/useNotificationStore'
import { playNotificationSound } from '../notifications/sounds'

interface UseBrowserNotificationsOptions {
  onPermissionDenied?: () => void
  /** Notification store from useNotificationStore — wired by the dashboard */
  store?: UseNotificationStoreReturn
}

export function useBrowserNotifications({
  onPermissionDenied,
  store,
}: UseBrowserNotificationsOptions = {}) {
  const [isSupported, setIsSupported] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const previousTasksRef = useRef<KodyTask[]>([])

  useEffect(() => {
    const supported = typeof window !== 'undefined' && 'Notification' in window
    setIsSupported(supported)
    if (supported) setPermission(Notification.permission)
  }, [])

  useEffect(() => {
    if (!isSupported) return
    setPermission(Notification.permission)
  }, [isSupported])

  /** Emit a notification to both browser + in-app store */
  const notify = useCallback(
    (
      type: NotificationType,
      title: string,
      body: string,
      opts?: { taskIssueNumber?: number; taskTitle?: string; meta?: Record<string, string> },
    ) => {
      // Check if type is enabled
      if (store && !store.isTypeEnabled(type)) return

      const meta = NOTIFICATION_META[type]

      // In-app notification
      store?.addNotification(type, title, body, opts)

      // Sound
      if (store?.prefs.soundEnabled !== false) {
        playNotificationSound(meta.priority)
      }

      // Browser (OS-level) notification
      if (
        isSupported &&
        Notification.permission === 'granted' &&
        store?.prefs.browserEnabled !== false
      ) {
        const notification = new Notification(`${meta.icon} ${title}`, {
          body,
          icon: '/favicon.ico',
          tag: opts?.taskIssueNumber ? `task-${opts.taskIssueNumber}` : undefined,
        })
        notification.onclick = () => {
          window.focus()
          notification.close()
        }
      }
    },
    [isSupported, store],
  )

  const requestPermission = useCallback(async () => {
    if (!isSupported) return
    if (Notification.permission === 'granted') return
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm === 'denied') onPermissionDenied?.()
    } else {
      setPermission(Notification.permission)
      if (Notification.permission === 'denied') onPermissionDenied?.()
    }
  }, [isSupported, onPermissionDenied])

  /** Check for task state changes and emit notifications */
  const checkTaskChanges = useCallback(
    (tasks: KodyTask[]) => {
      const previous = previousTasksRef.current
      if (previous.length === 0) {
        previousTasksRef.current = tasks
        return
      }

      const prevMap = new Map(previous.map((t) => [t.issueNumber, t]))

      for (const task of tasks) {
        const prev = prevMap.get(task.issueNumber)
        if (!prev) continue

        const from = prev.column
        const to = task.column
        const info = { taskIssueNumber: task.issueNumber, taskTitle: task.title }

        // Gate waiting
        if (from !== 'gate-waiting' && to === 'gate-waiting') {
          notify('gate-waiting', 'Task Needs Approval', task.title, info)
        }

        // Failed
        if (from !== 'failed' && to === 'failed') {
          const reason = task.isTimeout
            ? ' (timeout)'
            : task.isExhausted
              ? ' (retries exhausted)'
              : ''
          notify('task-failed', 'Task Failed', `${task.title}${reason}`, info)

          // If we have specific error info, also send build-error
          if (task.isSupervisorError) {
            notify('build-error', 'Build Error', `Infrastructure error on ${task.title}`, {
              ...info,
              meta: { errorType: 'supervisor' },
            })
          }
        }

        // Done
        if (from !== 'done' && to === 'done') {
          notify('task-completed', 'Task Completed', task.title, info)
        }

        // Started (open/failed/retrying → building/review)
        if (
          (from === 'open' || from === 'failed' || from === 'retrying') &&
          (to === 'building' || to === 'review')
        ) {
          notify('task-started', 'Task Started', task.title, info)
        }

        // Retry started
        if (from === 'failed' && to === 'retrying') {
          notify('retry-started', 'Retry Started', task.title, info)
        }

        // PR ready for review (moved to review column + has PR)
        if (from !== 'review' && to === 'review' && task.associatedPR) {
          notify('pr-ready', 'PR Ready for Review', `#${task.associatedPR.number}: ${task.title}`, {
            ...info,
            meta: { prNumber: String(task.associatedPR.number) },
          })
        }

        // PR merged (PR state changed to merged)
        if (prev.associatedPR?.state !== 'merged' && task.associatedPR?.state === 'merged') {
          notify('pr-merged', 'PR Merged', `#${task.associatedPR.number}: ${task.title}`, {
            ...info,
            meta: { prNumber: String(task.associatedPR.number) },
          })
        }

        // Stage change (pipeline stage changed)
        if (
          prev.pipeline?.currentStage &&
          task.pipeline?.currentStage &&
          prev.pipeline.currentStage !== task.pipeline.currentStage
        ) {
          notify(
            'stage-change',
            'Stage Changed',
            `${task.title}: ${prev.pipeline.currentStage} → ${task.pipeline.currentStage}`,
            {
              ...info,
              meta: { from: prev.pipeline.currentStage, to: task.pipeline.currentStage },
            },
          )
        }

        // Task assigned to user (assignees changed)
        const prevAssignees = new Set(prev.assignees?.map((a) => a.login) ?? [])
        const currAssignees = task.assignees?.map((a) => a.login) ?? []
        for (const login of currAssignees) {
          if (!prevAssignees.has(login)) {
            notify('task-assigned', 'Task Assigned', `${task.title} assigned to ${login}`, {
              ...info,
              meta: { assignee: login },
            })
          }
        }
      }

      previousTasksRef.current = tasks
    },
    [notify],
  )

  /** Send a chat response notification (called from KodyChat when tab unfocused) */
  const notifyChatResponse = useCallback(
    (taskTitle: string, preview: string, taskIssueNumber?: number) => {
      if (document.hasFocus()) return // Don't notify if tab is focused
      notify('chat-response', 'Chat Response', preview.slice(0, 100), {
        taskTitle,
        taskIssueNumber,
      })
    },
    [notify],
  )

  return {
    permission,
    requestPermission,
    checkTaskChanges,
    notifyChatResponse,
    isSupported,
  }
}
