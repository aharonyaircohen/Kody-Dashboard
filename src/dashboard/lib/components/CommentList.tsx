/**
 * @fileType component
 * @domain kody
 * @pattern comment-list
 * @ai-summary Component to display comments with markdown rendering
 */
'use client'

import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { formatRelativeTime } from '../utils'
import type { GitHubComment } from '../types'
import { Avatar, AvatarFallback, AvatarImage } from '@dashboard/ui/avatar'
import { cn } from '@dashboard/lib/utils/ui'

interface CommentListProps {
  comments: GitHubComment[]
  loading?: boolean
}

export function CommentList({ comments, loading }: CommentListProps) {
  // Auto-scroll to bottom when comments change - must be called before any early returns
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [comments])

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="animate-pulse p-3 rounded-lg border border-border">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-6 w-6 rounded-full bg-muted" />
              <div className="h-3 w-20 bg-muted rounded" />
            </div>
            <div className="h-12 bg-muted rounded" />
          </div>
        ))}
      </div>
    )
  }

  if (!comments || comments.length === 0) {
    return <div className="text-center py-8 text-muted-foreground text-sm">No comments yet</div>
  }

  return (
    <div ref={containerRef} className="space-y-3">
      {comments.map((comment) => (
        <CommentItem key={comment.id} comment={comment} />
      ))}
    </div>
  )
}

// Detect comment type from body content
function detectCommentType(body: string): string {
  if (body.includes('🚫 Hard Stop')) return 'hard-stop'
  if (body.includes('🚦 Risk Gate') || body.includes('Risk assessment required'))
    return 'risk-gated'
  if (body.includes('🚫 Gate Rejected') || body.includes('gate rejected')) return 'gate-rejection'
  if (body.includes('✅ Gate Approved') || body.includes('gate approved')) return 'gate-approval'
  if (
    body.includes('❌ Failed') ||
    body.includes('pipeline failed') ||
    body.includes('Build failed')
  )
    return 'failure'
  if (body.includes('⏰') || body.includes('timed out') || body.includes('timeout'))
    return 'timeout'
  if (body.includes('🔄') && body.includes('retry')) return 'retry'
  if (body.includes('exhausted') || body.includes('max retries')) return 'exhausted'
  if (body.includes('error') || body.includes('Error') || body.includes('failed with error'))
    return 'error'
  if (body.includes('💬') && body.includes('clarify')) return 'clarify'
  if (body.includes('🔗') && body.includes('vercel')) return 'preview'
  if (body.includes('🎉') || body.includes('completed successfully') || body.includes('Done!'))
    return 'success'
  return 'default'
}

// Get styling based on comment type
function getCommentStyle(type: string, isBot: boolean) {
  const base = 'p-2 rounded-lg border text-sm'

  switch (type) {
    case 'hard-stop':
      return cn(base, 'bg-red-500/10 border-red-500/50')
    case 'risk-gated':
      return cn(base, 'bg-yellow-500/10 border-yellow-500/50')
    case 'gate-rejection':
      return cn(base, 'bg-red-500/10 border-red-500/50')
    case 'gate-approval':
      return cn(base, 'bg-emerald-500/10 border-emerald-500/50')
    case 'failure':
      return cn(base, 'bg-red-500/10 border-red-500/30')
    case 'timeout':
      return cn(base, 'bg-orange-500/10 border-orange-500/50')
    case 'retry':
      return cn(base, 'bg-blue-500/10 border-blue-500/30')
    case 'exhausted':
      return cn(base, 'bg-orange-500/10 border-orange-500/50')
    case 'error':
      return cn(base, 'bg-red-500/10 border-red-500/30')
    case 'clarify':
      return cn(base, 'bg-blue-500/10 border-blue-500/30')
    case 'preview':
      return cn(base, 'bg-emerald-500/10 border-emerald-500/30')
    case 'success':
      return cn(base, 'bg-emerald-500/10 border-emerald-500/30')
    default:
      return cn(base, isBot ? 'bg-muted/30 border-muted' : 'bg-background border-border')
  }
}

function CommentItem({ comment }: { comment: GitHubComment }) {
  const isBot = comment.user.login.endsWith('[bot]')
  const commentType = detectCommentType(comment.body)
  const commentStyle = getCommentStyle(commentType, isBot)

  return (
    <div className={commentStyle}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        {commentType !== 'default' && (
          <span
            className={cn(
              'text-[10px] px-1.5 py-0.5 rounded font-medium uppercase shrink-0',
              commentType === 'hard-stop' && 'bg-red-600 text-white',
              commentType === 'risk-gated' && 'bg-yellow-600 text-white',
              commentType === 'gate-rejection' && 'bg-red-600 text-white',
              commentType === 'gate-approval' && 'bg-emerald-600 text-white',
              commentType === 'failure' && 'bg-red-600 text-white',
              commentType === 'timeout' && 'bg-orange-600 text-white',
              commentType === 'retry' && 'bg-blue-600 text-white',
              commentType === 'exhausted' && 'bg-orange-600 text-white',
              commentType === 'error' && 'bg-red-600 text-white',
              commentType === 'clarify' && 'bg-blue-600 text-white',
              commentType === 'preview' && 'bg-emerald-600 text-white',
              commentType === 'success' && 'bg-emerald-600 text-white',
            )}
          >
            {commentType}
          </span>
        )}
        <div className="flex items-center gap-2">
          <Avatar className="h-6 w-6">
            <AvatarImage src={comment.user.avatar_url} alt={comment.user.login} />
            <AvatarFallback className="text-xs">
              {comment.user.login[0]?.toUpperCase() || '?'}
            </AvatarFallback>
          </Avatar>
          <span
            className={cn(
              'text-sm font-medium',
              isBot ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            {comment.user.login}
            {isBot && <span className="ml-1 text-xs bg-muted px-1.5 py-0.5 rounded">BOT</span>}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(comment.created_at)}
        </span>
      </div>

      {/* Body - Rendered markdown */}
      <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // Custom code block rendering
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '')
              const isInline = !match

              if (isInline) {
                return (
                  <code className="bg-muted px-1 py-0.5 rounded text-xs" {...props}>
                    {children}
                  </code>
                )
              }

              return (
                <pre className="bg-muted p-2 rounded-md overflow-x-auto">
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              )
            },
            // Custom link rendering
            a({ href, children, ...props }) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                  {...props}
                >
                  {children}
                </a>
              )
            },
          }}
        >
          {comment.body}
        </ReactMarkdown>
      </div>
    </div>
  )
}
