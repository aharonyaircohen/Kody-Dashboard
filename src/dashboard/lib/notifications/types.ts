/**
 * @fileType types
 * @domain kody
 * @pattern notification-system
 * @ai-summary Notification type definitions for the Kody dashboard notification center
 */

export type NotificationType =
  | 'task-completed'
  | 'task-failed'
  | 'task-started'
  | 'gate-waiting'
  | 'pr-ready'
  | 'pr-merged'
  | 'stage-change'
  | 'chat-response'
  | 'task-assigned'
  | 'retry-started'
  | 'build-error'

export type NotificationPriority = 'high' | 'medium' | 'low'

export interface KodyNotification {
  id: string
  type: NotificationType
  title: string
  body: string
  timestamp: string
  read: boolean
  taskIssueNumber?: number
  taskTitle?: string
  meta?: Record<string, string>
}

export interface NotificationPrefs {
  browserEnabled: boolean
  inAppEnabled: boolean
  soundEnabled: boolean
  disabledTypes: NotificationType[]
}

export const DEFAULT_PREFS: NotificationPrefs = {
  browserEnabled: true,
  inAppEnabled: true,
  soundEnabled: true,
  disabledTypes: [],
}

export const NOTIFICATION_META: Record<
  NotificationType,
  { icon: string; label: string; priority: NotificationPriority }
> = {
  'task-completed': { icon: '✅', label: 'Task Completed', priority: 'medium' },
  'task-failed': { icon: '❌', label: 'Task Failed', priority: 'high' },
  'task-started': { icon: '🔄', label: 'Task Started', priority: 'low' },
  'gate-waiting': { icon: '🚦', label: 'Needs Approval', priority: 'high' },
  'pr-ready': { icon: '🔍', label: 'PR Ready for Review', priority: 'high' },
  'pr-merged': { icon: '🎉', label: 'PR Merged', priority: 'medium' },
  'stage-change': { icon: '⚙️', label: 'Stage Changed', priority: 'low' },
  'chat-response': { icon: '💬', label: 'Chat Response', priority: 'medium' },
  'task-assigned': { icon: '👤', label: 'Task Assigned', priority: 'high' },
  'retry-started': { icon: '🔁', label: 'Retry Started', priority: 'low' },
  'build-error': { icon: '🛑', label: 'Build Error', priority: 'high' },
}
