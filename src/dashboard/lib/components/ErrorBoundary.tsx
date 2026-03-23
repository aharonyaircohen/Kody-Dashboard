/**
 * @fileType component
 * @domain kody
 * @pattern error-boundary
 * @ai-summary React error boundary that catches render errors and shows a "Something went wrong" fallback
 */
'use client'

import { Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@dashboard/ui/button'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, info)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-red-500/10 ring-1 ring-red-500/20 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-red-400" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Something went wrong</p>
            {this.state.error && (
              <p className="text-xs text-muted-foreground max-w-sm break-words">
                {this.state.error.message}
              </p>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={this.handleReload}>
            Reload
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}
