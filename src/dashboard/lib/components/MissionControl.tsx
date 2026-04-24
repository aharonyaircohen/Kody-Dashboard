/**
 * @fileType component
 * @domain kody
 * @pattern mission-control-page
 * @ai-summary Mission Control — list, view, create, edit, and delete missions.
 *   A mission is a GitHub issue labelled `kody:mission` whose body describes
 *   its intent, system prompt, allowed commands, and restrictions.
 */
'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  RefreshCw,
  Target,
  Terminal,
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
  useCreateMission,
  useDeleteMission,
  useMissions,
  useUpdateMission,
} from '../hooks/useMissions'
import { useGitHubIdentity } from '../hooks/useGitHubIdentity'
import type { Mission } from '../api'
import { MISSION_TEMPLATE } from '../mission-template'
import { composeMissionPrompt } from '../mission-prompt'
import { ConfirmDialog } from './ConfirmDialog'
import { MarkdownEditor } from './MarkdownEditor'

export function MissionControl({ titleSlot }: { titleSlot?: React.ReactNode } = {}) {
  return (
    <AuthGuard>
      <MissionControlInner titleSlot={titleSlot} />
    </AuthGuard>
  )
}

export function MissionControlInner({ titleSlot }: { titleSlot?: React.ReactNode }) {
  const { data: missions = [], isLoading, isFetching, refetch, error } = useMissions()

  const [selectedNumber, setSelectedNumber] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editingMission, setEditingMission] = useState<Mission | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Mission | null>(null)

  const selectedMission = useMemo(
    () => missions.find((m) => m.number === selectedNumber) ?? null,
    [missions, selectedNumber],
  )

  useEffect(() => {
    if (!selectedNumber && missions.length > 0) {
      setSelectedNumber(missions[0].number)
    }
  }, [missions, selectedNumber])

  const { githubUser } = useGitHubIdentity()
  const deleteMutation = useDeleteMission(githubUser?.login)

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
              <Target className="w-5 h-5 text-emerald-400" />
              Mission Control
            </h1>
          )}
          <span className="text-xs text-muted-foreground">
            {missions.length} {missions.length === 1 ? 'mission' : 'missions'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh missions"
          >
            <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1">
            <Plus className="w-4 h-4" />
            New mission
          </Button>
        </div>
      </header>

      {error ? (
        <div className="shrink-0 px-4 py-3 bg-red-500/10 border-b border-red-500/20 text-sm text-red-400">
          Failed to load missions: {(error as Error).message}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 flex">
        {/* Left: mission list */}
        <aside className="w-72 md:w-80 border-r border-border overflow-y-auto">
          {isLoading ? (
            <EmptyState icon={<FileText />} title="Loading missions…" />
          ) : missions.length === 0 ? (
            <EmptyState
              icon={<Target />}
              title="No missions yet"
              hint="Create your first mission to describe the intent, system prompt, and restrictions."
            />
          ) : (
            <ul className="divide-y divide-border">
              {missions.map((mission) => (
                <li key={mission.number}>
                  <button
                    type="button"
                    onClick={() => setSelectedNumber(mission.number)}
                    className={cn(
                      'w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors',
                      selectedNumber === mission.number && 'bg-accent/70',
                    )}
                  >
                    <div className="font-medium text-sm truncate">{mission.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      #{mission.number} · updated{' '}
                      {new Date(mission.updatedAt).toLocaleDateString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Right: mission detail */}
        <section className="flex-1 min-w-0 overflow-y-auto">
          {selectedMission ? (
            <MissionDetail
              mission={selectedMission}
              onEdit={() => setEditingMission(selectedMission)}
              onDelete={() => setPendingDelete(selectedMission)}
            />
          ) : (
            <EmptyState
              icon={<Target />}
              title="Select a mission"
              hint="Pick a mission from the list to see its intent and system prompt."
            />
          )}
        </section>
      </div>

      {/* Create */}
      <CreateMissionDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(mission) => {
          setSelectedNumber(mission.number)
          setShowCreate(false)
        }}
      />

      {/* Edit */}
      {editingMission ? (
        <EditMissionDialog
          mission={editingMission}
          onClose={() => setEditingMission(null)}
          onSaved={() => setEditingMission(null)}
        />
      ) : null}

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!pendingDelete}
        title="Close this mission?"
        description={
          pendingDelete
            ? `Mission #${pendingDelete.number} "${pendingDelete.title}" will be closed on GitHub. You can reopen it from there.`
            : ''
        }
        variant="destructive"
        confirmLabel="Close mission"
        onConfirm={() => {
          if (!pendingDelete) return
          const target = pendingDelete
          deleteMutation.mutate(target.number, {
            onSuccess: () => {
              if (selectedNumber === target.number) setSelectedNumber(null)
            },
          })
        }}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}

function MissionDetail({
  mission,
  onEdit,
  onDelete,
}: {
  mission: Mission
  onEdit: () => void
  onDelete: () => void
}) {
  const [showComposed, setShowComposed] = useState(false)
  const [copied, setCopied] = useState(false)
  const composed = useMemo(() => composeMissionPrompt(mission), [mission])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(composed)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be blocked in some contexts; fail silently
    }
  }

  return (
    <article className="p-6 max-w-3xl">
      <header className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold break-words">{mission.title}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            #{mission.number} · created {new Date(mission.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={mission.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            title="Open on GitHub"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            GitHub
          </a>
          <Button
            variant={showComposed ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setShowComposed((prev) => !prev)}
            className="gap-1"
          >
            <Terminal className="w-3.5 h-3.5" />
            {showComposed ? 'Mission body' : 'Composed prompt'}
          </Button>
          <Button variant="outline" size="sm" onClick={onEdit} className="gap-1">
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={onDelete} className="gap-1 text-red-400">
            <Trash2 className="w-3.5 h-3.5" />
            Close
          </Button>
        </div>
      </header>

      {showComposed ? (
        <div className="border border-border rounded-md overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border text-xs">
            <span className="text-muted-foreground">
              System prompt + mission body, as the executor will see it.
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 hover:text-foreground text-muted-foreground"
              title="Copy composed prompt"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="p-4 text-xs whitespace-pre-wrap break-words font-mono bg-background max-h-[70vh] overflow-y-auto">
            {composed}
          </pre>
        </div>
      ) : (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          {mission.body.trim() ? (
            <ReactMarkdown>{mission.body}</ReactMarkdown>
          ) : (
            <p className="text-muted-foreground italic">No description yet.</p>
          )}
        </div>
      )}
    </article>
  )
}

function CreateMissionDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (mission: Mission) => void
}) {
  const { githubUser } = useGitHubIdentity()
  const createMutation = useCreateMission(githubUser?.login)

  const [title, setTitle] = useState('')
  const [body, setBody] = useState(MISSION_TEMPLATE)

  useEffect(() => {
    if (open) {
      setTitle('')
      setBody(MISSION_TEMPLATE)
    }
  }, [open])

  const handleSubmit = () => {
    if (!title.trim() || createMutation.isPending) return
    createMutation.mutate(
      { title: title.trim(), body },
      {
        onSuccess: (mission) => onCreated(mission),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New mission</DialogTitle>
          <DialogDescription>
            Describe the mission&apos;s intent, system prompt, allowed commands, and restrictions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="mission-title">Title</Label>
            <Input
              id="mission-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Release notes manager"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Body</Label>
            <MarkdownEditor value={body} onChange={setBody} rows={14} />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!title.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating…' : 'Create mission'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EditMissionDialog({
  mission,
  onClose,
  onSaved,
}: {
  mission: Mission
  onClose: () => void
  onSaved: () => void
}) {
  const { githubUser } = useGitHubIdentity()
  const updateMutation = useUpdateMission(mission.number, githubUser?.login)

  const [title, setTitle] = useState(mission.title)
  const [body, setBody] = useState(mission.body || '')

  useEffect(() => {
    setTitle(mission.title)
    setBody(mission.body || '')
  }, [mission])

  const handleSubmit = () => {
    if (!title.trim() || updateMutation.isPending) return
    const patch: { title?: string; body?: string } = {}
    if (title !== mission.title) patch.title = title.trim()
    if (body !== mission.body) patch.body = body
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
          <DialogTitle>Edit mission #{mission.number}</DialogTitle>
          <DialogDescription>
            Update the mission&apos;s title or body. Changes are written back to the GitHub issue.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-mission-title">Title</Label>
            <Input
              id="edit-mission-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Body</Label>
            <MarkdownEditor value={body} onChange={setBody} rows={14} />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!title.trim() || updateMutation.isPending}
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
