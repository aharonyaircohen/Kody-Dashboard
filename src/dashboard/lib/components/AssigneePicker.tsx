/**
 * @fileType component
 * @domain kody
 * @pattern assignee-picker
 * @ai-summary Inline assignee management with cached collaborators, loading states, and remove buttons
 */
'use client'

import { useState } from 'react'
import { Button } from '@dashboard/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@dashboard/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@dashboard/ui/avatar'
import { Loader2, Plus, X } from 'lucide-react'
import { useCollaborators } from '../hooks'

export interface AssigneeChangeEvent {
  action: 'assign' | 'unassign'
  login: string
  avatar_url: string
}

interface AssigneePickerProps {
  issueNumber: number
  currentAssignees: Array<{ login: string; avatar_url: string }>
  onChange?: (event: AssigneeChangeEvent) => void
}

export function AssigneePicker({ issueNumber, currentAssignees, onChange }: AssigneePickerProps) {
  const { data: collaborators = [], isLoading: isLoadingCollaborators } = useCollaborators()
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const currentLogins = currentAssignees.map((a) => a.login)
  const availableCollaborators = collaborators.filter((c) => !currentLogins.includes(c.login))

  const handleAssign = async (login: string) => {
    setPendingAction(`assign:${login}`)
    try {
      const res = await fetch(`/api/kody/tasks/issue-${issueNumber}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'assign',
          assignees: [login],
        }),
      })

      if (!res.ok) {
        throw new Error('Failed to assign')
      }

      const collab = collaborators.find((c) => c.login === login)
      onChange?.({ action: 'assign', login, avatar_url: collab?.avatar_url || '' })
      setOpen(false)
    } catch (err) {
      console.error('Failed to assign:', err)
    } finally {
      setPendingAction(null)
    }
  }

  const handleUnassign = async (login: string) => {
    setPendingAction(`unassign:${login}`)
    try {
      const res = await fetch(`/api/kody/tasks/issue-${issueNumber}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'unassign',
          assignees: [login],
        }),
      })

      if (!res.ok) {
        throw new Error('Failed to unassign')
      }

      const assignee = currentAssignees.find((a) => a.login === login)
      onChange?.({ action: 'unassign', login, avatar_url: assignee?.avatar_url || '' })
    } catch (err) {
      console.error('Failed to unassign:', err)
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <div className="space-y-2">
      {/* Current assignees with remove buttons */}
      {currentAssignees.map((assignee) => {
        const isRemoving = pendingAction === `unassign:${assignee.login}`
        return (
          <div
            key={assignee.login}
            className="flex items-center gap-2 group bg-background px-2 py-1.5 rounded-md border border-border/50"
          >
            <Avatar className="h-5 w-5">
              <AvatarImage src={assignee.avatar_url} alt={assignee.login} />
              <AvatarFallback className="text-[10px]">
                {assignee.login[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs text-foreground flex-1">{assignee.login}</span>
            <button
              onClick={() => handleUnassign(assignee.login)}
              disabled={!!pendingAction}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive text-muted-foreground transition-opacity disabled:opacity-50"
              title={`Remove ${assignee.login}`}
            >
              {isRemoving ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <X className="w-3 h-3" />
              )}
            </button>
          </div>
        )
      })}

      {currentAssignees.length === 0 && (
        <span className="text-xs text-muted-foreground italic">Unassigned</span>
      )}

      {/* Add assignee dropdown */}
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-start gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            disabled={!!pendingAction}
          >
            {pendingAction?.startsWith('assign:') ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Plus className="w-3 h-3" />
            )}
            Add assignee
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {isLoadingCollaborators ? (
            <DropdownMenuItem disabled className="flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading collaborators...
            </DropdownMenuItem>
          ) : availableCollaborators.length === 0 ? (
            <DropdownMenuItem disabled className="text-muted-foreground">
              {collaborators.length === 0 ? 'No collaborators' : 'All collaborators assigned'}
            </DropdownMenuItem>
          ) : (
            availableCollaborators.map((user) => {
              const isAssigning = pendingAction === `assign:${user.login}`
              return (
                <DropdownMenuItem
                  key={user.login}
                  onClick={() => handleAssign(user.login)}
                  disabled={!!pendingAction}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  {isAssigning ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Avatar className="h-5 w-5">
                      <AvatarImage src={user.avatar_url} alt={user.login} />
                      <AvatarFallback className="text-[8px]">
                        {user.login[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <span>{user.login}</span>
                </DropdownMenuItem>
              )
            })
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
