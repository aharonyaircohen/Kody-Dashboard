/**
 * @fileType component
 * @domain kody
 * @pattern tool-call-card
 * @ai-summary Expandable tool call card showing name, arguments, result, status, and duration
 */
'use client'

import { useState } from 'react'
import { cn } from '@dashboard/lib/utils/ui'

interface ToolCall {
  name: string
  arguments: Record<string, unknown>
  result?: unknown
  status: 'running' | 'success' | 'error'
  startedAt?: number
  durationMs?: number
}

interface ToolCallCardProps {
  toolCall: ToolCall
  expanded?: boolean
  className?: string
}

/**
 * Format a tool name for display (e.g., "get_file_contents" -> "Get File Contents")
 */
function formatToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

/**
 * Format arguments or result as JSON
 */
function formatJSON(obj: unknown, maxLength = 500): string {
  const json = JSON.stringify(obj, null, 2)
  if (json.length <= maxLength) return json
  return json.slice(0, maxLength) + '\n\n[... truncated ...]'
}

export function ToolCallCard({ toolCall, className }: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const statusStyles: Record<string, { icon: string; borderColor: string; bgColor: string }> = {
    running: {
      icon: '⏳',
      borderColor: 'border-blue-500',
      bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    },
    success: {
      icon: '✅',
      borderColor: 'border-green-500',
      bgColor: 'bg-green-50 dark:bg-green-900/20',
    },
    error: { icon: '❌', borderColor: 'border-red-500', bgColor: 'bg-red-50 dark:bg-red-900/20' },
  }

  const status = statusStyles[toolCall.status]
  const hasArguments = Object.keys(toolCall.arguments).length > 0
  const hasResult = toolCall.result !== undefined

  return (
    <div
      className={cn(
        'rounded-lg border-l-4 overflow-hidden transition-all',
        status.borderColor,
        status.bgColor,
        className,
      )}
    >
      {/* Header - always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-black/5 dark:hover:bg-white/5"
      >
        <span className="text-sm">{status.icon}</span>
        <span className="font-medium text-sm flex-1">{formatToolName(toolCall.name)}</span>
        {toolCall.durationMs !== undefined && (
          <span className="text-xs text-muted-foreground">
            {toolCall.durationMs < 1000
              ? `${toolCall.durationMs}ms`
              : `${(toolCall.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
        <span className="text-muted-foreground text-xs">{isExpanded ? '▼' : '▶'}</span>
      </button>

      {/* Expandable content */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* Arguments */}
          {hasArguments && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Input:</p>
              <pre className="text-xs bg-background p-2 rounded overflow-x-auto max-h-32">
                <code>{formatJSON(toolCall.arguments)}</code>
              </pre>
            </div>
          )}

          {/* Result */}
          {hasResult && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Output:</p>
              <pre className="text-xs bg-background p-2 rounded overflow-x-auto max-h-48">
                <code>
                  {toolCall.status === 'error'
                    ? formatJSON({ error: toolCall.result })
                    : formatJSON(toolCall.result)}
                </code>
              </pre>
            </div>
          )}

          {/* Running state */}
          {toolCall.status === 'running' && (
            <p className="text-xs text-muted-foreground italic">Running...</p>
          )}

          {/* Error state */}
          {toolCall.status === 'error' && !hasResult && (
            <p className="text-xs text-red-600 dark:text-red-400">
              {String(toolCall.result || 'Tool call failed')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Render multiple tool calls in a compact list
 */
interface ToolCallListProps {
  toolCalls: ToolCall[]
  className?: string
}

export function ToolCallList({ toolCalls, className }: ToolCallListProps) {
  if (toolCalls.length === 0) return null

  return (
    <div className={cn('space-y-1', className)}>
      {toolCalls.map((tc, i) => (
        <ToolCallCard key={i} toolCall={tc} />
      ))}
    </div>
  )
}
