/**
 * @fileType component
 * @domain kody
 * @pattern goal-picker
 * @ai-summary Attach or detach a task from goals. Each goal maps to a GitHub
 *   label `goal:<id>`; toggling adds or removes the label via the existing
 *   task-action endpoint. GitHub auto-creates the label on first use.
 */
'use client'

import { useState } from 'react'
import { Flag } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@dashboard/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dashboard/ui/dropdown-menu'
import { useGoals } from '../hooks/useGoals'
import { GOAL_LABEL_PREFIX } from '../goals'

interface GoalPickerProps {
  issueNumber: number
  currentLabels: string[]
  onChange?: () => void
}

export function GoalPicker({ issueNumber, currentLabels, onChange }: GoalPickerProps) {
  const { data: goals = [], isLoading } = useGoals()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const attachedGoalIds = new Set(
    currentLabels
      .filter((l) => l.startsWith(GOAL_LABEL_PREFIX))
      .map((l) => l.slice(GOAL_LABEL_PREFIX.length)),
  )

  const toggle = async (goalId: string, isApplied: boolean) => {
    const label = `${GOAL_LABEL_PREFIX}${goalId}`
    setPendingId(goalId)
    try {
      const res = await fetch(`/api/kody/tasks/issue-${issueNumber}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: isApplied ? 'remove-label' : 'add-label',
          label,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || 'Failed to update goal')
      }
      onChange?.()
    } catch (e) {
      toast.error(
        isApplied ? 'Failed to detach goal' : 'Failed to attach goal',
        { description: (e as Error).message },
      )
    } finally {
      setPendingId(null)
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1 h-7 text-xs">
          <Flag className="w-3 h-3 text-sky-400" />
          Goals
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Attach to goals
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isLoading ? (
          <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
        ) : goals.length === 0 ? (
          <DropdownMenuItem disabled className="text-muted-foreground">
            No goals yet — create one in Work → Goals.
          </DropdownMenuItem>
        ) : (
          goals.map((goal) => {
            const isApplied = attachedGoalIds.has(goal.id)
            const isPending = pendingId === goal.id
            return (
              <DropdownMenuItem
                key={goal.id}
                onSelect={(e) => {
                  e.preventDefault()
                  if (!isPending) void toggle(goal.id, isApplied)
                }}
                disabled={isPending}
                className="flex items-center gap-2 cursor-pointer"
              >
                <Flag className="w-3 h-3 shrink-0 text-sky-400" />
                <span className="truncate flex-1">{goal.name}</span>
                {isApplied ? (
                  <span className="text-xs text-sky-400">✓</span>
                ) : null}
              </DropdownMenuItem>
            )
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
