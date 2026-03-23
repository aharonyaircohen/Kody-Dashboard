/**
 * @fileType component
 * @domain kody
 * @pattern comment-box
 * @ai-summary Comment input component for writing comments on issues
 */
'use client'

import { useState } from 'react'
import { Button } from '@dashboard/ui/button'
import { Textarea } from '@dashboard/ui/textarea'

interface CommentBoxProps {
  issueNumber: number
  onCommentPosted?: () => void
}

export function CommentBox({ issueNumber, onCommentPosted }: CommentBoxProps) {
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!comment.trim()) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/kody/tasks/issue-${issueNumber}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'comment',
          comment: comment.trim(),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to post comment')
      }

      setComment('')
      onCommentPosted?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post comment')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Write a comment..."
        rows={3}
        disabled={loading}
      />
      <div className="flex justify-between items-center">
        {error && <span className="text-destructive text-sm">{error}</span>}
        <div className="ml-auto">
          <Button onClick={handleSubmit} disabled={loading || !comment.trim()} size="sm">
            {loading ? 'Posting...' : 'Comment'}
          </Button>
        </div>
      </div>
    </div>
  )
}
