/**
 * @fileType component
 * @domain kody
 * @pattern message-actions
 * @ai-summary Per-message action buttons (copy, retry, edit, delete) with hover reveal
 */
'use client'

import { useState } from 'react'
import { cn } from '@dashboard/lib/utils/ui'
import { ConfirmDialog } from './ConfirmDialog'

interface MessageActionsProps {
  role: 'user' | 'assistant'
  content: string
  isLast: boolean
  isLoading: boolean
  hasToolCalls?: boolean
  onCopy: () => string
  onRetry?: () => void
  onEdit?: (content: string) => void
  onDelete: () => void
  className?: string
}

export function MessageActions({
  role,
  isLast,
  isLoading,
  hasToolCalls,
  onCopy,
  onRetry,
  onEdit,
  onDelete,
  className,
}: MessageActionsProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [copied, setCopied] = useState(false)

  if (isLoading) return null

  const handleCopy = async () => {
    await navigator.clipboard.writeText(onCopy() || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleStartEdit = () => {
    setEditContent(onCopy() || '')
    setIsEditing(true)
  }

  const handleSaveEdit = () => {
    if (editContent.trim() && onEdit) {
      onEdit(editContent.trim())
    }
    setIsEditing(false)
    setEditContent('')
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditContent('')
  }

  const canRetry = role === 'assistant' && isLast && onRetry
  const canEdit = role === 'user' && onEdit
  const canDelete = true

  // No actions for loading messages
  if (!canRetry && !canEdit && !canDelete) return null

  return (
    <>
      <div
        className={cn(
          'absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 z-10',
          className,
        )}
      >
        {/* Copy button */}
        <button
          onClick={handleCopy}
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          title={copied ? 'Copied!' : 'Copy'}
        >
          {copied ? '✓' : '📋'}
        </button>

        {/* Retry button (only for last assistant message) */}
        {canRetry && (
          <button
            onClick={onRetry}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            title="Regenerate response"
          >
            🔄
          </button>
        )}

        {/* Edit button (only for user messages) */}
        {canEdit && (
          <button
            onClick={handleStartEdit}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            title="Edit and resend"
          >
            ✏️
          </button>
        )}

        {/* Delete button */}
        {canDelete && (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
            title="Delete message"
          >
            🗑️
          </button>
        )}
      </div>

      {/* Edit Modal (inline) */}
      {isEditing && (
        <div className="absolute inset-0 bg-background/95 flex items-center justify-center p-4 z-20">
          <div className="w-full max-w-md">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full h-32 p-2 border rounded-md text-sm resize-none"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={handleCancelEdit}
                className="px-3 py-1 text-sm rounded hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => {
          onDelete()
          setShowDeleteConfirm(false)
        }}
        title="Delete message?"
        description={
          hasToolCalls
            ? 'This message has tool calls. Deleting it will also remove the tool results. This cannot be undone.'
            : 'This will remove the message from the conversation. This cannot be undone.'
        }
        confirmLabel="Delete"
        variant="destructive"
      />
    </>
  )
}
