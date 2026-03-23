/**
 * @fileType component
 * @domain kody
 * @pattern simple-tooltip
 * @ai-summary Convenience wrapper around shadcn Tooltip for Kody dashboard — supports string or ReactNode content
 */
'use client'

import React from 'react'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@dashboard/ui/tooltip'

interface SimpleTooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  delayDuration?: number
  className?: string
  /** Maximum width for tooltip content */
  maxWidth?: string
}

export function SimpleTooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  delayDuration = 300,
  className,
  maxWidth = '320px',
}: SimpleTooltipProps) {
  if (!content) return <>{children}</>

  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} align={align} className={className} style={{ maxWidth }}>
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
