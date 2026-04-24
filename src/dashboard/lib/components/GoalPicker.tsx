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
import { useGitHubIdentity } from '../hooks/useGitHubIdentity'
import { tasksApi } from '../api'
import { GOAL_LABEL_PREFIX } from '../goals'

interface GoalPickerProps {
  issueNumber: number
  currentLabels: string[]
  onChange?: () => void
  fullWidth?: boolean
  triggerLabel?: string
}

export function GoalPicker({
  issueNumber,
  currentLabels,
  onChange,
  fullWidth = false,
  triggerLabel = 'Attach to goals',
}: GoalPickerProps) {
  const { data: goals = [], isLoading } = useGoals()
  const { githubUser } = useGitHubIdentity()
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
      if (isApplied) {
        await tasksApi.removeLabel(issueNumber, label, githubUser?.login)
      } else {
        await tasksApi.addLabel(issueNumber, label, githubUser?.login)
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
        <Button
          variant="outline"
          size="sm"
          className={
            fullWidth
              ? 'w-full justify-start gap-1.5'
              : 'gap-1.5'
          }
        >
          <Flag className="w-3.5 h-3.5 text-sky-400" />
          {triggerLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={fullWidth ? 'start' : 'end'} className="w-64">
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
