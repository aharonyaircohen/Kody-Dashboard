/**
 * @fileType component
 * @domain kody
 * @pattern label-picker
 * @ai-summary Dropdown component for adding/removing labels on issues
 */
'use client'

import { useEffect, useState } from 'react'
import { Button } from '@dashboard/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dashboard/ui/dropdown-menu'

interface LabelPickerProps {
  issueNumber: number
  currentLabels: Array<{ name: string; color: string }>
  onChange?: () => void
}

interface RepoLabel {
  name: string
  color: string
}

export function LabelPicker({ issueNumber, currentLabels, onChange }: LabelPickerProps) {
  const [labels, setLabels] = useState<RepoLabel[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    async function fetchLabels() {
      try {
        const res = await fetch('/api/kody/boards')
        const data = await res.json()
        // Extract labels from boards - boards include labels
        const allLabels: RepoLabel[] = []
        data.boards?.forEach((board: { type: string; labels?: RepoLabel[] }) => {
          if (board.type === 'label' && board.labels) {
            allLabels.push(...board.labels)
          }
        })
        setLabels(allLabels)
      } catch (err) {
        console.error('Failed to fetch labels:', err)
      } finally {
        setLoading(false)
      }
    }

    if (open) {
      fetchLabels()
    }
  }, [open])

  const currentLabelNames = currentLabels.map((l) => l.name)

  const handleAddLabel = async (label: string) => {
    try {
      const res = await fetch(`/api/kody/tasks/issue-${issueNumber}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add-label',
          label,
        }),
      })

      if (!res.ok) {
        throw new Error('Failed to add label')
      }

      onChange?.()
    } catch (err) {
      console.error('Failed to add label:', err)
    }
  }

  const handleRemoveLabel = async (label: string) => {
    try {
      const res = await fetch(`/api/kody/tasks/issue-${issueNumber}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remove-label',
          label,
        }),
      })

      if (!res.ok) {
        throw new Error('Failed to remove label')
      }

      onChange?.()
    } catch (err) {
      console.error('Failed to remove label:', err)
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          Labels
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {loading ? (
          <DropdownMenuItem disabled>Loading...</DropdownMenuItem>
        ) : labels.length === 0 ? (
          <DropdownMenuItem disabled>No labels in repo</DropdownMenuItem>
        ) : (
          <>
            {labels.map((label) => {
              const isApplied = currentLabelNames.includes(label.name)
              return (
                <DropdownMenuItem
                  key={label.name}
                  onClick={() =>
                    isApplied ? handleRemoveLabel(label.name) : handleAddLabel(label.name)
                  }
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <span
                    className="h-4 w-4 rounded-full border"
                    style={{
                      backgroundColor: `#${label.color}`,
                      borderColor: `#${label.color}`,
                    }}
                  />
                  <span>{label.name}</span>
                  {isApplied && <span className="ml-auto text-xs">✓</span>}
                </DropdownMenuItem>
              )
            })}
          </>
        )}

        {currentLabels.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled className="text-muted-foreground">
              Current: {currentLabels.map((l) => l.name).join(', ')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
