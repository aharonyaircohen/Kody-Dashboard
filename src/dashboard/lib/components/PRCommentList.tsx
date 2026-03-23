/**
 * @fileType component
 * @domain kody
 * @pattern pr-comment-list
 * @ai-summary Renders PR comments with markdown and author avatars
 */
'use client'

import { useState, useEffect } from 'react'
import type { PRComment } from '../types'
import { prsApi } from '../api'
import { MarkdownViewer } from './MarkdownViewer'
import { Avatar, AvatarFallback, AvatarImage } from '@dashboard/ui/avatar'
import { Loader2, MessageSquare } from 'lucide-react'
import { formatRelativeTime } from '../utils'

interface PRCommentListProps {
  prNumber: number
  className?: string
  onCountChange?: (count: number) => void
}

export function PRCommentList({ prNumber, className, onCountChange }: PRCommentListProps) {
  const [comments, setComments] = useState<PRComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    prsApi
      .comments(prNumber)
      .then((data) => {
        if (!cancelled) {
          setComments(data)
          onCountChange?.(data.length)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load comments')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [prNumber, onCountChange])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    )
  }

  if (comments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2 text-zinc-500">
        <MessageSquare className="w-6 h-6" />
        <p className="text-sm">No PR comments yet</p>
      </div>
    )
  }

  return (
    <div className={className}>
      <div className="space-y-3">
        {comments.map((comment) => (
          <div key={comment.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Avatar className="h-5 w-5">
                <AvatarImage src={comment.user.avatar_url} alt={comment.user.login} />
                <AvatarFallback className="text-[9px]">
                  {comment.user.login[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-xs font-medium text-zinc-300">{comment.user.login}</span>
              <span className="text-xs text-zinc-600">
                {formatRelativeTime(comment.created_at)}
              </span>
            </div>
            <div className="text-sm">
              <MarkdownViewer content={comment.body} title="" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
