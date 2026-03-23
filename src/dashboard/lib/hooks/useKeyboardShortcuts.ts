/**
 * @fileType hook
 * @domain kody
 * @pattern keyboard-shortcuts
 * @ai-summary Hook for keyboard navigation shortcuts in Kody dashboard
 */
'use client'

import { useEffect, useCallback } from 'react'

interface KeyboardShortcutHandlers {
  onNavigateDown?: () => void
  onNavigateUp?: () => void
  onOpenSelected?: () => void
  onCloseDetail?: () => void
  onRefresh?: () => void
  onNewTask?: () => void
  onEdit?: () => void
  onOpenPreview?: () => void
  onFocusSearch?: () => void
  onShowHelp?: () => void
  /** If true, skip shortcuts that open modals/dialogs */
  isModalOpen?: boolean
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers) {
  const { isModalOpen = false, ...restHandlers } = handlers

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Skip if user is typing in an input/textarea
      const target = event.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.tagName === 'SELECT'
      ) {
        return
      }

      // Skip if modifier keys are pressed (except for potential future shortcuts)
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      // Skip shortcuts that open modals when a modal is already open
      if (isModalOpen) {
        // Allow Escape to close modals
        if (event.key !== 'Escape') {
          return
        }
      }

      switch (event.key) {
        case 'j':
          restHandlers.onNavigateDown?.()
          break
        case 'k':
          restHandlers.onNavigateUp?.()
          break
        case 'Enter':
          event.preventDefault()
          restHandlers.onOpenSelected?.()
          break
        case 'Escape':
          restHandlers.onCloseDetail?.()
          break
        case 'r':
          // Only trigger refresh if not in an input
          restHandlers.onRefresh?.()
          break
        case 'n':
          restHandlers.onNewTask?.()
          break
        case 'e':
          restHandlers.onEdit?.()
          break
        case 'p':
          restHandlers.onOpenPreview?.()
          break
        case '/':
          event.preventDefault()
          restHandlers.onFocusSearch?.()
          break
        case '?':
          restHandlers.onShowHelp?.()
          break
      }
    },
    [isModalOpen, restHandlers],
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])
}
