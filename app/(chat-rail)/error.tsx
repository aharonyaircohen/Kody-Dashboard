/**
 * @fileType error-boundary
 * @domain kody
 * @pattern next-error-boundary
 * @ai-summary Error boundary for the (chat-rail) route group — catches errors
 *   thrown by pages inside this group (and the group layout) without losing
 *   the chat rail chrome rendered by the root layout's ChatRailShell.
 */
'use client'

import { useEffect } from 'react'
import { Button } from '@dashboard/ui/button'
import { AlertTriangle } from 'lucide-react'

export default function ChatRailGroupError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[KodyDashboard] (chat-rail) error:', error)
  }, [error])

  const isDev = process.env.NODE_ENV !== 'production'

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="text-center max-w-md">
        <AlertTriangle className="w-10 h-10 text-yellow-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-foreground mb-2">
          This page hit an error
        </h2>
        <p className="text-sm text-muted-foreground mb-3">
          The Kody dashboard couldn't render this page. The chat rail and
          navigation are still available.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground/70 font-mono mb-3">
            ref: {error.digest}
          </p>
        )}
        {isDev && error.message && (
          <pre className="text-xs text-left bg-muted p-3 rounded-md mb-4 overflow-auto max-h-40">
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ''}
          </pre>
        )}
        <div className="flex gap-2 justify-center">
          <Button onClick={() => reset()} variant="default" size="sm">
            Try again
          </Button>
          <Button
            onClick={() => window.location.reload()}
            variant="outline"
            size="sm"
          >
            Reload page
          </Button>
        </div>
      </div>
    </div>
  )
}
