/**
 * @fileType component
 * @domain kody
 * @pattern task-session-history
 * @ai-summary Read-only view of all pipeline and dashboard sessions for a task
 */
'use client'

import { useState } from 'react'
import { cn } from '@dashboard/lib/utils/ui'
import type { ChatSession } from '../chat-types'

interface TaskSessionHistoryProps {
  sessions: ChatSession[]
  className?: string
}

/**
 * Get color for a stage name
 */
function getStageColor(stage: string): { bg: string; text: string; label: string } {
  if (stage === 'dashboard') {
    return {
      bg: 'bg-blue-100 dark:bg-blue-900/30',
      text: 'text-blue-700 dark:text-blue-300',
      label: '💬',
    }
  }

  const stageColors: Record<string, { bg: string; text: string; label: string }> = {
    taskify: {
      bg: 'bg-purple-100 dark:bg-purple-900/30',
      text: 'text-purple-700 dark:text-purple-300',
      label: '📋',
    },
    spec: {
      bg: 'bg-amber-100 dark:bg-amber-900/30',
      text: 'text-amber-700 dark:text-amber-300',
      label: '📝',
    },
    architect: {
      bg: 'bg-emerald-100 dark:bg-emerald-900/30',
      text: 'text-emerald-700 dark:text-emerald-300',
      label: '🏗️',
    },
    plan: {
      bg: 'bg-teal-100 dark:bg-teal-900/30',
      text: 'text-teal-700 dark:text-teal-300',
      label: '📐',
    },
    build: {
      bg: 'bg-orange-100 dark:bg-orange-900/30',
      text: 'text-orange-700 dark:text-orange-300',
      label: '🔧',
    },
    commit: {
      bg: 'bg-cyan-100 dark:bg-cyan-900/30',
      text: 'text-cyan-700 dark:text-cyan-300',
      label: '💾',
    },
    verify: {
      bg: 'bg-green-100 dark:bg-green-900/30',
      text: 'text-green-700 dark:text-green-300',
      label: '✅',
    },
    pr: {
      bg: 'bg-indigo-100 dark:bg-indigo-900/30',
      text: 'text-indigo-700 dark:text-indigo-300',
      label: '📥',
    },
    autofix: {
      bg: 'bg-red-100 dark:bg-red-900/30',
      text: 'text-red-700 dark:text-red-300',
      label: '🔄',
    },
  }

  return (
    stageColors[stage] || {
      bg: 'bg-gray-100 dark:bg-gray-900/30',
      text: 'text-gray-700 dark:text-gray-300',
      label: '❓',
    }
  )
}

/**
 * Format date for display
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Preview of a message (truncated)
 */
function MessagePreview({ text }: { text: string }) {
  const truncated = text.length > 100 ? text.slice(0, 100) + '...' : text
  return <p className="text-xs text-muted-foreground line-clamp-2">{truncated}</p>
}

export function TaskSessionHistory({ sessions, className }: TaskSessionHistoryProps) {
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set())

  const toggleExpand = (sessionId: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev)
      if (next.has(sessionId)) {
        next.delete(sessionId)
      } else {
        next.add(sessionId)
      }
      return next
    })
  }

  // Sort sessions: pipeline stages first (in order), then dashboard
  const pipelineStages = [
    'taskify',
    'spec',
    'architect',
    'plan',
    'build',
    'commit',
    'verify',
    'pr',
    'autofix',
  ]
  const sortedSessions = [...sessions].sort((a, b) => {
    const aIndex = pipelineStages.indexOf(a.stage)
    const bIndex = pipelineStages.indexOf(b.stage)

    // Both are pipeline stages - use stage order
    if (aIndex !== -1 && bIndex !== -1) {
      return aIndex - bIndex
    }

    // Dashboard sessions last
    if (a.stage === 'dashboard') return 1
    if (b.stage === 'dashboard') return -1

    // Unknown stages - by date
    return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  })

  if (sessions.length === 0) {
    return null
  }

  return (
    <div className={cn('border rounded-lg overflow-hidden', className)}>
      <div className="bg-muted/50 px-3 py-2 border-b">
        <h3 className="text-sm font-semibold">Session History</h3>
        <p className="text-xs text-muted-foreground">
          {sessions.length} session{sessions.length !== 1 ? 's' : ''} in this task
        </p>
      </div>

      <div className="divide-y max-h-64 overflow-auto">
        {sortedSessions.map((session) => {
          const isExpanded = expandedSessions.has(session.stage + session.startedAt)
          const color = getStageColor(session.stage)

          return (
            <div key={session.stage + session.startedAt} className="hover:bg-muted/30">
              {/* Session Header */}
              <button
                onClick={() => toggleExpand(session.stage + session.startedAt)}
                className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-transparent"
              >
                <span
                  className={cn('px-2 py-0.5 rounded text-xs font-medium', color.bg, color.text)}
                >
                  {color.label} {session.stage}
                </span>
                <span className="text-xs text-muted-foreground flex-1">
                  {formatDate(session.startedAt)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {session.messages.length} msg{session.messages.length !== 1 ? 's' : ''}
                </span>
                {session.messages[0]?.tools && session.messages[0].tools.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    🔧 {session.messages[0].tools.length} tool
                    {session.messages[0].tools.length !== 1 ? 's' : ''}
                  </span>
                )}
                <span className="text-muted-foreground text-xs">{isExpanded ? '▼' : '▶'}</span>
              </button>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-2">
                  {session.messages.map((msg, i) => (
                    <div
                      key={i}
                      className={cn(
                        'px-2 py-1.5 rounded text-xs',
                        msg.role === 'user' ? 'bg-primary/10 text-primary-foreground' : 'bg-muted',
                      )}
                    >
                      <div className="flex items-center gap-1 mb-1">
                        <span className="font-medium">{msg.role === 'user' ? '👤' : '🤖'}</span>
                        <span className="text-muted-foreground text-[10px]">
                          {new Date(msg.timestamp).toLocaleTimeString()}
                        </span>
                        {msg.tools && msg.tools.length > 0 && (
                          <span className="text-amber-600 text-[10px]">
                            🔧 {msg.tools.join(', ')}
                          </span>
                        )}
                      </div>
                      <MessagePreview text={msg.text} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
