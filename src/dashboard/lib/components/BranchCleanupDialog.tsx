/**
 * @fileType component
 * @domain kody
 * @pattern branch-cleanup-dialog
 * @ai-summary Dialog to view and delete branches associated with closed/done tasks
 */
'use client'

import { useState } from 'react'
import { Button } from '@dashboard/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@dashboard/ui/dialog'
import { Badge } from '@dashboard/ui/badge'
import { CheckCircle2, XCircle, Trash2, Loader2, GitBranch } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { cn } from '../utils'
import { SessionExpiredError, redirectToLogin } from '../api'

interface BranchCleanupDialogProps {
  open: boolean
  onClose: () => void
}

interface BranchInfo {
  name: string
  taskTitle: string
  issueNumber: number
  status: 'done' | 'failed' | 'closed'
}

export function BranchCleanupDialog({ open, onClose }: BranchCleanupDialogProps) {
  const queryClient = useQueryClient()
  const [branchesToDelete, setBranchesToDelete] = useState<Set<string>>(new Set())

  // Fetch list of branches from the API
  const { data: branches = [], isLoading } = useQuery<BranchInfo[]>({
    queryKey: ['kody-branches'],
    queryFn: async () => {
      const response = await fetch('/api/kody/branches')
      if (!response.ok) throw new Error('Failed to fetch branches')
      return response.json()
    },
    enabled: open,
  })

  // Bulk delete mutation
  const bulkDeleteMutation = useMutation({
    mutationFn: async (branchNames: string[]) => {
      const response = await fetch('/api/kody/branches/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branches: branchNames }),
      })
      if (!response.ok) throw new Error('Failed to delete branches')
      return response.json()
    },
    onSuccess: () => {
      toast.success(`Deleted ${branchesToDelete.size} branches`)
      setBranchesToDelete(new Set())
      queryClient.invalidateQueries({ queryKey: ['kody-branches'] })
    },
    onError: (error) => {
      if (error instanceof SessionExpiredError) {
        redirectToLogin()
      } else {
        toast.error(`Failed to delete branches: ${error}`)
      }
    },
  })

  const toggleBranch = (branchName: string) => {
    setBranchesToDelete((prev) => {
      const next = new Set(prev)
      if (next.has(branchName)) {
        next.delete(branchName)
      } else {
        next.add(branchName)
      }
      return next
    })
  }

  const toggleAll = () => {
    if (branchesToDelete.size === branches.length) {
      setBranchesToDelete(new Set())
    } else {
      setBranchesToDelete(new Set(branches.map((b) => b.name)))
    }
  }

  const handleDeleteSelected = () => {
    bulkDeleteMutation.mutate(Array.from(branchesToDelete))
  }

  // Filter branches that can be deleted (done, failed, or closed)
  const deletableBranches = branches.filter(
    (b) => b.status === 'done' || b.status === 'failed' || b.status === 'closed',
  )

  const statusColors = {
    done: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    failed: 'bg-red-500/20 text-red-400 border-red-500/30',
    closed: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="w-5 h-5" />
            Branch Cleanup
          </DialogTitle>
          <DialogDescription>
            Delete branches from closed, failed, or completed tasks to keep your repository clean.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : deletableBranches.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-500" />
            <p>No branches to clean up!</p>
            <p className="text-sm mt-1">All branches are from active tasks.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={branchesToDelete.size === deletableBranches.length}
                  onChange={toggleAll}
                  className="rounded border-border"
                />
                Select all ({deletableBranches.length})
              </label>
              <Button
                variant="destructive"
                size="sm"
                disabled={branchesToDelete.size === 0 || bulkDeleteMutation.isPending}
                onClick={handleDeleteSelected}
              >
                {bulkDeleteMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4 mr-1" />
                )}
                Delete ({branchesToDelete.size})
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 py-2">
              {deletableBranches.map((branch) => (
                <div
                  key={branch.name}
                  className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={branchesToDelete.has(branch.name)}
                    onChange={() => toggleBranch(branch.name)}
                    className="rounded border-border"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{branch.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      #{branch.issueNumber} - {branch.taskTitle}
                    </p>
                  </div>
                  <Badge variant="outline" className={cn('text-xs', statusColors[branch.status])}>
                    {branch.status === 'done' && <CheckCircle2 className="w-3 h-3 mr-1" />}
                    {branch.status === 'failed' && <XCircle className="w-3 h-3 mr-1" />}
                    {branch.status}
                  </Badge>
                </div>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
