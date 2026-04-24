/**
 * @fileType component
 * @domain kody
 * @pattern goal-control-page
 * @ai-summary Goals panel — list, view, create, edit, and delete goals.
 *   Goals are JSON entries stored inside a manifest GitHub issue labelled
 *   `kody:goals-manifest`. Task linkage (via `goal:<slug>` labels) is a later phase.
 */
'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Calendar,
  CheckCircle,
  CircleDashed,
  ExternalLink,
  Flag,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Button } from '@dashboard/ui/button'
import { Input } from '@dashboard/ui/input'
import { Label } from '@dashboard/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@dashboard/ui/dialog'
import { AuthGuard } from '../auth-guard'
import { cn } from '../utils'
import {
  useCreateGoal,
  useDeleteGoal,
  useGoals,
  useUpdateGoal,
} from '../hooks/useGoals'
import { useKodyTasks } from '../hooks'
import { useGitHubIdentity } from '../hooks/useGitHubIdentity'
import type { Goal } from '../api'
import type { KodyTask } from '../types'
import { GOAL_LABEL_PREFIX } from '../goals'
import { getGitHubIssueUrl } from '../constants'
import { ConfirmDialog } from './ConfirmDialog'
import { MarkdownEditor } from './MarkdownEditor'

interface GoalProgress {
  total: number
  done: number
  tasks: KodyTask[]
}

function computeProgress(tasks: KodyTask[]): GoalProgress {
  const done = tasks.filter((t) => t.state === 'closed' || t.column === 'done').length
  return { total: tasks.length, done, tasks }
}

export function GoalControl({ titleSlot }: { titleSlot?: React.ReactNode } = {}) {
  return (
    <AuthGuard>
      <GoalControlInner titleSlot={titleSlot} />
    </AuthGuard>
  )
}

export function GoalControlInner({ titleSlot }: { titleSlot?: React.ReactNode }) {
  const { data: goals = [], isLoading, isFetching, refetch, error } = useGoals()
  const { data: tasks = [] } = useKodyTasks()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Goal | null>(null)

  const selectedGoal = useMemo(
    () => goals.find((g) => g.id === selectedId) ?? null,
    [goals, selectedId],
  )

  const progressByGoal = useMemo(() => {
    const map = new Map<string, GoalProgress>()
    for (const goal of goals) {
      const label = `${GOAL_LABEL_PREFIX}${goal.id}`
      const attached = tasks.filter((t) => t.labels.includes(label))
      map.set(goal.id, computeProgress(attached))
    }
    return map
  }, [goals, tasks])

  useEffect(() => {
    if (!selectedId && goals.length > 0) {
      setSelectedId(goals[0].id)
    }
  }, [goals, selectedId])

  const { githubUser } = useGitHubIdentity()
  const deleteMutation = useDeleteGoal(githubUser?.login)

  return (
    <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
      <header className="shrink-0 flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-white/[0.06] bg-black/20">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </Link>
          <span className="h-4 w-px bg-border" />
          {titleSlot ?? (
            <h1 className="inline-flex items-center gap-2 text-lg md:text-xl font-semibold">
              <Flag className="w-5 h-5 text-sky-400" />
              Goals
            </h1>
          )}
          <span className="text-xs text-muted-foreground">
            {goals.length} {goals.length === 1 ? 'goal' : 'goals'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh goals"
          >
            <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1">
            <Plus className="w-4 h-4" />
            New goal
          </Button>
        </div>
      </header>

      {error ? (
        <div className="shrink-0 px-4 py-3 bg-red-500/10 border-b border-red-500/20 text-sm text-red-400">
          Failed to load goals: {(error as Error).message}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 flex">
        <aside className="w-72 md:w-80 border-r border-border overflow-y-auto">
          {isLoading ? (
            <EmptyState icon={<Flag />} title="Loading goals…" />
          ) : goals.length === 0 ? (
            <EmptyState
              icon={<Flag />}
              title="No goals yet"
              hint="Create your first goal to describe an outcome the system is working toward."
            />
          ) : (
            <ul className="divide-y divide-border">
              {goals.map((goal) => {
                const progress = progressByGoal.get(goal.id) ?? {
                  total: 0,
                  done: 0,
                  tasks: [],
                }
                const pct =
                  progress.total > 0 ? (progress.done / progress.total) * 100 : 0
                return (
                  <li key={goal.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(goal.id)}
                      className={cn(
                        'w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors',
                        selectedId === goal.id && 'bg-accent/70',
                      )}
                    >
                      <div className="font-medium text-sm truncate">{goal.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1 tabular-nums">
                          <CheckCircle className="w-3 h-3" />
                          {progress.done}/{progress.total}
                        </span>
                        {goal.dueDate ? (
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {formatDueDate(goal.dueDate)}
                          </span>
                        ) : null}
                      </div>
                      {progress.total > 0 ? (
                        <div className="mt-2 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                          <div
                            className="h-full bg-sky-400/70 transition-[width] duration-300"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>

        <section className="flex-1 min-w-0 overflow-y-auto">
          {selectedGoal ? (
            <GoalDetail
              goal={selectedGoal}
              progress={
                progressByGoal.get(selectedGoal.id) ?? {
                  total: 0,
                  done: 0,
                  tasks: [],
                }
              }
              onEdit={() => setEditingGoal(selectedGoal)}
              onDelete={() => setPendingDelete(selectedGoal)}
            />
          ) : (
            <EmptyState
              icon={<Flag />}
              title="Select a goal"
              hint="Pick a goal from the list to see its description and details."
            />
          )}
        </section>
      </div>

      <CreateGoalDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(goal) => {
          setSelectedId(goal.id)
          setShowCreate(false)
        }}
      />

      {editingGoal ? (
        <EditGoalDialog
          goal={editingGoal}
          onClose={() => setEditingGoal(null)}
          onSaved={() => setEditingGoal(null)}
        />
      ) : null}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Remove this goal?"
        description={
          pendingDelete
            ? `Goal "${pendingDelete.name}" will be removed from the manifest. Tasks labelled with this goal keep their labels (you can clean them up on GitHub).`
            : ''
        }
        variant="destructive"
        confirmLabel="Remove goal"
        onConfirm={() => {
          if (!pendingDelete) return
          const target = pendingDelete
          deleteMutation.mutate(target.id, {
            onSuccess: () => {
              if (selectedId === target.id) setSelectedId(null)
            },
          })
        }}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}

function GoalDetail({
  goal,
  progress,
  onEdit,
  onDelete,
}: {
  goal: Goal
  progress: GoalProgress
  onEdit: () => void
  onDelete: () => void
}) {
  const pct = progress.total > 0 ? (progress.done / progress.total) * 100 : 0
  const openTasks = progress.tasks.filter(
    (t) => !(t.state === 'closed' || t.column === 'done'),
  )
  const doneTasks = progress.tasks.filter(
    (t) => t.state === 'closed' || t.column === 'done',
  )
  return (
    <article className="p-6 max-w-3xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold break-words">{goal.name}</h2>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
            <span className="font-mono">{goal.id}</span>
            <span>created {new Date(goal.createdAt).toLocaleDateString()}</span>
            {goal.dueDate ? (
              <span className="inline-flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                due {formatDueDate(goal.dueDate)}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={onEdit} className="gap-1">
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={onDelete} className="gap-1 text-red-400">
            <Trash2 className="w-3.5 h-3.5" />
            Remove
          </Button>
        </div>
      </header>

      {/* Progress */}
      <section className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle className="w-3.5 h-3.5 text-sky-400" />
            <span className="tabular-nums text-foreground font-medium">
              {progress.done}
            </span>
            <span>of</span>
            <span className="tabular-nums text-foreground font-medium">
              {progress.total}
            </span>
            <span>{progress.total === 1 ? 'task done' : 'tasks done'}</span>
          </span>
          <span className="tabular-nums">{Math.round(pct)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full bg-sky-400/80 transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </section>

      {/* Description */}
      <section className="prose prose-sm dark:prose-invert max-w-none">
        {goal.description?.trim() ? (
          <ReactMarkdown>{goal.description}</ReactMarkdown>
        ) : (
          <p className="text-muted-foreground italic">No description yet.</p>
        )}
      </section>

      {/* Tasks */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Tasks</h3>
        {progress.total === 0 ? (
          <p className="text-xs text-muted-foreground">
            No tasks attached yet. Open a task and use the Goals picker to attach it.
          </p>
        ) : (
          <div className="space-y-4">
            {openTasks.length > 0 ? (
              <TaskGroup
                heading={`In progress (${openTasks.length})`}
                tasks={openTasks}
              />
            ) : null}
            {doneTasks.length > 0 ? (
              <TaskGroup heading={`Done (${doneTasks.length})`} tasks={doneTasks} />
            ) : null}
          </div>
        )}
      </section>
    </article>
  )
}

function TaskGroup({
  heading,
  tasks,
}: {
  heading: string
  tasks: KodyTask[]
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
        {heading}
      </div>
      <ul className="divide-y divide-white/[0.04] rounded-lg border border-white/[0.06] bg-white/[0.02]">
        {tasks.map((task) => {
          const isDone = task.state === 'closed' || task.column === 'done'
          return (
            <li
              key={task.issueNumber}
              className="flex items-center gap-3 px-3 py-2 text-sm"
            >
              {isDone ? (
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <CircleDashed className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              )}
              <span className="font-mono text-xs text-muted-foreground shrink-0">
                #{task.issueNumber}
              </span>
              <Link
                href={`/${task.issueNumber}`}
                className="truncate flex-1 hover:text-sky-400 transition-colors"
                title={task.title}
              >
                {task.title}
              </Link>
              <a
                href={getGitHubIssueUrl(task.issueNumber)}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground shrink-0"
                title="Open on GitHub"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function CreateGoalDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (goal: Goal) => void
}) {
  const { githubUser } = useGitHubIdentity()
  const createMutation = useCreateGoal(githubUser?.login)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')

  useEffect(() => {
    if (open) {
      setName('')
      setDescription('')
      setDueDate('')
    }
  }, [open])

  const handleSubmit = () => {
    if (!name.trim() || createMutation.isPending) return
    createMutation.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        dueDate: dueDate.trim() || undefined,
      },
      {
        onSuccess: (goal) => onCreated(goal),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New goal</DialogTitle>
          <DialogDescription>
            Describe the outcome. Tasks can later be attached to this goal via a label.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="goal-name">Name</Label>
            <Input
              id="goal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ship checkout rewrite"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="goal-due">Due date (optional)</Label>
            <Input
              id="goal-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description (optional)</Label>
            <MarkdownEditor value={description} onChange={setDescription} rows={10} />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!name.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating…' : 'Create goal'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EditGoalDialog({
  goal,
  onClose,
  onSaved,
}: {
  goal: Goal
  onClose: () => void
  onSaved: () => void
}) {
  const { githubUser } = useGitHubIdentity()
  const updateMutation = useUpdateGoal(goal.id, githubUser?.login)

  const [name, setName] = useState(goal.name)
  const [description, setDescription] = useState(goal.description ?? '')
  const [dueDate, setDueDate] = useState(goal.dueDate ?? '')

  useEffect(() => {
    setName(goal.name)
    setDescription(goal.description ?? '')
    setDueDate(goal.dueDate ?? '')
  }, [goal])

  const handleSubmit = () => {
    if (!name.trim() || updateMutation.isPending) return
    const patch: {
      name?: string
      description?: string | null
      dueDate?: string | null
    } = {}
    if (name.trim() !== goal.name) patch.name = name.trim()
    if ((description ?? '') !== (goal.description ?? '')) {
      patch.description = description.trim() ? description.trim() : null
    }
    if ((dueDate ?? '') !== (goal.dueDate ?? '')) {
      patch.dueDate = dueDate.trim() ? dueDate.trim() : null
    }
    if (Object.keys(patch).length === 0) {
      onSaved()
      return
    }
    updateMutation.mutate(patch, { onSuccess: () => onSaved() })
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit goal</DialogTitle>
          <DialogDescription>
            Update the goal name, due date, or description. Changes are written back to the manifest issue.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-goal-name">Name</Label>
            <Input
              id="edit-goal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-goal-due">Due date</Label>
            <Input
              id="edit-goal-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <MarkdownEditor value={description} onChange={setDescription} rows={10} />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!name.trim() || updateMutation.isPending}
          >
            {updateMutation.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode
  title: string
  hint?: string
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 py-16 text-muted-foreground">
      <div className="w-10 h-10 mb-3 opacity-60">{icon}</div>
      <div className="text-sm font-medium text-foreground">{title}</div>
      {hint ? <p className="text-xs mt-1 max-w-xs">{hint}</p> : null}
    </div>
  )
}

function formatDueDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString()
}
