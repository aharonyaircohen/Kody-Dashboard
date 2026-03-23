/**
 * @fileType component
 * @domain kody
 * @pattern session-sidebar
 * @ai-summary Session list sidebar for Kody global chat - displays, creates, switches, and deletes sessions
 */
'use client'

import { useState, useRef, useEffect } from 'react'
import { cn } from '@dashboard/lib/utils/ui'
import { ConfirmDialog } from './ConfirmDialog'
import type { SessionMeta } from '../chat-types'
import type { AgentId } from '../agents'

interface SessionSidebarProps {
  sessions: SessionMeta[]
  activeSessionId: string | null
  agentId: AgentId
  onSwitchSession: (sessionId: string) => void
  onCreateSession: () => void
  onDeleteSession: (sessionId: string) => void
  onRenameSession: (sessionId: string, title: string) => void
  onPinSession: (sessionId: string) => void
  className?: string
}

/**
 * Format a date as relative time (e.g., "2h ago", "Yesterday")
 */
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString()
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  agentId: _agentId,
  onSwitchSession,
  onCreateSession,
  onDeleteSession,
  onRenameSession,
  onPinSession,
  className,
}: SessionSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  // Focus input when editing starts
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingId])

  const handleStartEdit = (session: SessionMeta) => {
    setEditingId(session.id)
    setEditTitle(session.title)
  }

  const handleSaveEdit = () => {
    if (editingId && editTitle.trim()) {
      onRenameSession(editingId, editTitle.trim())
    }
    setEditingId(null)
    setEditTitle('')
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditTitle('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      handleCancelEdit()
    }
  }

  return (
    <div className={cn('flex flex-col h-full bg-background border-r', className)}>
      {/* Header */}
      <div className="p-3 border-b">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">Conversations</h3>
          <span className="text-xs text-muted-foreground">{sessions.length}</span>
        </div>
        <button
          onClick={onCreateSession}
          className="w-full px-3 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          + New conversation
        </button>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-auto">
        {sessions.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No conversations yet.
            <br />
            Start a new one above.
          </div>
        ) : (
          <ul className="divide-y">
            {sessions.map((session) => (
              <li
                key={session.id}
                className={cn(
                  'group relative cursor-pointer hover:bg-muted/50 transition-colors',
                  session.id === activeSessionId && 'bg-muted',
                )}
                onClick={() => session.id !== activeSessionId && onSwitchSession(session.id)}
              >
                <div className="p-3">
                  {/* Pin indicator */}
                  {session.pinned && (
                    <span className="absolute top-2 right-8 text-amber-500 text-xs">📌</span>
                  )}

                  {/* Title */}
                  {editingId === session.id ? (
                    <input
                      ref={editInputRef}
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={handleSaveEdit}
                      onKeyDown={handleKeyDown}
                      className="w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <p
                      className={cn(
                        'text-sm font-medium truncate pr-16',
                        session.id === activeSessionId && 'text-primary',
                      )}
                    >
                      {session.title}
                    </p>
                  )}

                  {/* Meta */}
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span>{formatRelativeTime(session.updatedAt)}</span>
                    <span>•</span>
                    <span>{session.messageCount} messages</span>
                  </div>
                </div>

                {/* Actions (visible on hover) */}
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {/* Pin button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onPinSession(session.id)
                    }}
                    className="p-1 rounded hover:bg-muted"
                    title={session.pinned ? 'Unpin' : 'Pin'}
                  >
                    {session.pinned ? '📌' : '📍'}
                  </button>

                  {/* Edit button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleStartEdit(session)
                    }}
                    className="p-1 rounded hover:bg-muted"
                    title="Rename"
                  >
                    ✏️
                  </button>

                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteConfirmId(session.id)
                    }}
                    className="p-1 rounded hover:bg-muted text-destructive"
                    title="Delete"
                  >
                    🗑️
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={() => {
          if (deleteConfirmId) {
            onDeleteSession(deleteConfirmId)
            setDeleteConfirmId(null)
          }
        }}
        title="Delete conversation?"
        description="This will permanently delete this conversation and all its messages. This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
      />
    </div>
  )
}
