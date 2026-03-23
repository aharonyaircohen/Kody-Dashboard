/**
 * @fileType component
 * @domain kody
 * @pattern keyboard-shortcuts-dialog
 * @ai-summary Dialog showing keyboard shortcuts available in Kody dashboard
 */
'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@dashboard/ui/dialog'

interface KeyboardShortcutsDialogProps {
  open: boolean
  onClose: () => void
}

const shortcuts = [
  { key: 'j', description: 'Navigate down in task list' },
  { key: 'k', description: 'Navigate up in task list' },
  { key: 'Enter', description: 'Open selected task' },
  { key: 'Esc', description: 'Close task detail or dialog' },
  { key: 'r', description: 'Refresh tasks' },
  { key: 'n', description: 'Create new task' },
  { key: 'e', description: 'Edit selected task' },
  { key: 'p', description: 'Open preview (if PR exists)' },
  { key: '/', description: 'Focus search input' },
  { key: '?', description: 'Show this help' },
]

export function KeyboardShortcutsDialog({ open, onClose }: KeyboardShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Navigate and manage tasks faster with these keyboard shortcuts.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 py-4">
          {shortcuts.map((shortcut) => (
            <div
              key={shortcut.key}
              className="flex items-center justify-between gap-4 px-3 py-2 rounded-md bg-muted/50"
            >
              <kbd className="px-2 py-1 text-xs font-mono bg-background border border-border rounded shadow-sm min-w-[2rem] text-center">
                {shortcut.key === ' ' ? 'Space' : shortcut.key}
              </kbd>
              <span className="text-sm text-muted-foreground">{shortcut.description}</span>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Press{' '}
          <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted border border-border rounded">
            ?
          </kbd>{' '}
          anytime to show this help.
        </p>
      </DialogContent>
    </Dialog>
  )
}
