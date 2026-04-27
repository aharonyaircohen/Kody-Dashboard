/**
 * @fileType component
 * @domain kody
 * @pattern mission-control-page
 * @ai-summary Mission Control — list, view, create, edit, and delete missions.
 *   A mission is a markdown file at `.kody/missions/<slug>.md` in the
 *   connected repo whose body describes the mission's intent, allowed
 *   commands, and restrictions.
 */
'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Calendar,
  ExternalLink,
  FileText,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
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
  useRunMission,
  useUpdateMission,
} from '../hooks/useMissions'
import { useGitHubIdentity } from '../hooks/useGitHubIdentity'
import type { Mission } from '../api'
import { MISSION_TEMPLATE } from '../mission-template'
import { ConfirmDialog } from './ConfirmDialog'
import { MarkdownEditor } from './MarkdownEditor'
import { KodyChat } from './KodyChat'

function newDraftId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function MissionControl({ titleSlot }: { titleSlot?: React.ReactNode } = {}) {
  return (
    <AuthGuard>
      <MissionControlInner titleSlot={titleSlot} />
    </AuthGuard>
  )
}

export function MissionControlInner({ titleSlot }: { titleSlot?: React.ReactNode }) {
  const { data: missions = [], isLoading, isFetching, refetch, error } = useMissions()

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editingMission, setEditingMission] = useState<Mission | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Mission | null>(null)
  const [pendingRun, setPendingRun] = useState<Mission | null>(null)

  // Chat-panel state. The left rail switches between three modes:
  //  • mission mode  — when a mission is selected and we're not drafting
  //  • draft mode    — when "Draft new mission" is active (rotates draftId)
  //  • disabled      — neither (e.g. no missions yet)
  // `draftPrefill` carries an assistant reply the user picked via
  // "Use as mission" into CreateMissionDialog.
  const [isDrafting, setIsDrafting] = useState(false)
  const [draftId, setDraftId] = useState<string>(() => newDraftId())
  const [draftPrefill, setDraftPrefill] = useState<string | null>(null)
  const startNewDraft = () => {
    setIsDrafting(true)
    setDraftId(newDraftId())
  }
  const cancelDraft = () => setIsDrafting(false)

  const selectedMission = useMemo(
    () => missions.find((m) => m.slug === selectedSlug) ?? null,
    [missions, selectedSlug],
  )

  useEffect(() => {
    if (!selectedSlug && missions.length > 0) {
      setSelectedSlug(missions[0].slug)
    }
  }, [missions, selectedSlug])

  const { githubUser } = useGitHubIdentity()
  const deleteMutation = useDeleteMission(githubUser?.login)
  const runMutation = useRunMission()

  return (
    <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
      <header className="shrink-0 flex items-center justify-between gap-2 px-3 md:px-6 py-2 md:py-4 border-b border-white/[0.06] bg-black/20">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm shrink-0"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Dashboard</span>
          </Link>
          <span className="hidden sm:block h-4 w-px bg-border" />
          {titleSlot ?? (
            <h1 className="inline-flex items-center gap-2 text-lg md:text-xl font-semibold">
              <Target className="w-5 h-5 text-emerald-400" />
              Mission Control
            </h1>
          )}
          <span className="hidden md:inline text-xs text-muted-foreground">
            {missions.length} {missions.length === 1 ? 'mission' : 'missions'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh missions"
          >
            <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
          </Button>
          {isDrafting ? (
            <Button
              variant="outline"
              size="sm"
              onClick={cancelDraft}
              className="gap-1"
              title="Stop drafting; chat returns to the selected mission"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back to mission</span>
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={startNewDraft}
              className="gap-1"
              title="Chat with Kody to scope a brand-new mission"
            >
              <Sparkles className="w-4 h-4" />
              <span className="hidden sm:inline">Draft new</span>
            </Button>
          )}
          <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New mission</span>
          </Button>
        </div>
      </header>

      {error ? (
        <div className="shrink-0 px-4 py-3 bg-red-500/10 border-b border-red-500/20 text-sm text-red-400">
          Failed to load missions: {(error as Error).message}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 flex">
        {/* Desktop left rail: persistent chat, same pattern as
            KodyDashboard's task chat panel. The chat's context follows the
            user's intent: drafting a new mission, or chatting about the
            currently selected one. */}
        <div className="hidden md:block w-[400px] shrink-0 border-r border-border">
          <KodyChat
            context={
              isDrafting
                ? {
                    kind: 'mission-draft',
                    draftId,
                    onFinalize: (assistantContent) => {
                      setDraftPrefill(assistantContent)
                      setShowCreate(true)
                    },
                  }
                : selectedMission
                  ? { kind: 'mission', mission: selectedMission }
                  : null
            }
            actorLogin={githubUser?.login}
          />
        </div>

        {/* Middle: mission list */}
        <aside
          className={cn(
            'w-full md:w-80 md:border-r md:border-border overflow-y-auto',
            selectedMission && 'hidden md:block',
          )}
        >
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
              {missions.map((mission) => {
                const isActive = selectedSlug === mission.slug
                return (
                  <li key={mission.slug}>
                    <button
                      type="button"
                      onClick={() => setSelectedSlug(mission.slug)}
                      className={cn(
                        'w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors relative',
                        isActive && 'bg-accent/70',
                      )}
                    >
                      {isActive ? (
                        <span className="absolute inset-y-0 left-0 w-0.5 bg-emerald-400" />
                      ) : null}
                      <div className="flex items-center gap-2">
                        <Target
                          className={cn(
                            'w-3.5 h-3.5 shrink-0',
                            isActive ? 'text-emerald-400' : 'text-muted-foreground',
                          )}
                        />
                        <span className="font-medium text-sm truncate flex-1">
                          {mission.title}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                        <span className="font-mono opacity-80">{mission.slug}</span>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(mission.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>

        {/* Right: mission detail */}
        <section
          className={cn(
            'flex-1 min-w-0 overflow-y-auto',
            !selectedMission && 'hidden md:block',
          )}
        >
          {selectedMission ? (
            <MissionDetail
              mission={selectedMission}
              onBack={() => setSelectedSlug(null)}
              onEdit={() => setEditingMission(selectedMission)}
              onDelete={() => setPendingDelete(selectedMission)}
              onRun={() => setPendingRun(selectedMission)}
              isRunning={
                runMutation.isPending && runMutation.variables?.slug === selectedMission.slug
              }
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
        initialBody={draftPrefill}
        onClose={() => {
          setShowCreate(false)
          setDraftPrefill(null)
        }}
        onCreated={(mission) => {
          setSelectedSlug(mission.slug)
          setShowCreate(false)
          setDraftPrefill(null)
          // Drop out of draft mode so the chat is now scoped to the
          // newly-created mission instead of the old draft session.
          setIsDrafting(false)
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

      {/* Run confirm */}
      <ConfirmDialog
        open={!!pendingRun}
        title="Run this mission?"
        description={
          pendingRun
            ? `Dispatches kody.yml with mission "${pendingRun.title}" (${pendingRun.slug}) as the prompt. GitHub Actions minutes will be consumed and kody may make real repo writes.`
            : ''
        }
        confirmLabel="Run mission"
        onConfirm={() => {
          if (!pendingRun) return
          runMutation.mutate({
            slug: pendingRun.slug,
            title: pendingRun.title,
            body: pendingRun.body,
          })
        }}
        onClose={() => setPendingRun(null)}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete this mission?"
        description={
          pendingDelete
            ? `Mission "${pendingDelete.title}" (${pendingDelete.slug}) will be removed from .kody/missions/ via a commit on the default branch.`
            : ''
        }
        variant="destructive"
        confirmLabel="Delete mission"
        onConfirm={() => {
          if (!pendingDelete) return
          const target = pendingDelete
          deleteMutation.mutate(target.slug, {
            onSuccess: () => {
              if (selectedSlug === target.slug) setSelectedSlug(null)
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
  onBack,
  onEdit,
  onDelete,
  onRun,
  isRunning,
}: {
  mission: Mission
  onBack: () => void
  onEdit: () => void
  onDelete: () => void
  onRun: () => void
  isRunning: boolean
}) {
  const hasBody = mission.body.trim().length > 0
  return (
    <article className="min-h-full">
      {/* Hero */}
      <div className="border-b border-white/[0.06] bg-gradient-to-b from-emerald-500/[0.06] via-emerald-500/[0.02] to-transparent">
        <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="md:hidden gap-1 -ml-2 text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            All missions
          </Button>
          <header className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="inline-flex items-center gap-2 text-xs text-emerald-400 font-medium uppercase tracking-wider">
                <Target className="w-3.5 h-3.5" />
                Mission
              </div>
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight break-words">
                {mission.title}
              </h1>
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                <span className="font-mono opacity-80">{mission.slug}</span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  updated {new Date(mission.updatedAt).toLocaleDateString()}
                </span>
                <span>·</span>
                <a
                  href={mission.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                  title="Open on GitHub"
                >
                  <ExternalLink className="w-3 h-3" />
                  GitHub
                </a>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                onClick={onRun}
                disabled={isRunning}
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Play className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">
                  {isRunning ? 'Dispatching…' : 'Run'}
                </span>
              </Button>
              <Button variant="outline" size="sm" onClick={onEdit} className="gap-1.5">
                <Pencil className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Edit</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onDelete}
                className="gap-1.5 text-red-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Close</span>
              </Button>
            </div>
          </header>

          {/* Description card inside the hero when present */}
          {hasBody ? (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 md:p-5">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{mission.body}</ReactMarkdown>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Empty body fallback below the hero (mirrors goal detail's empty tasks card) */}
      {!hasBody ? (
        <div className="max-w-4xl mx-auto p-4 md:p-8">
          <div className="rounded-xl border border-dashed border-white/[0.1] bg-white/[0.02] py-12 text-center space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                No description yet
              </p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Use <span className="font-medium text-foreground">Edit</span> to
                describe the mission&apos;s intent, system prompt, allowed
                commands, and restrictions.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={onEdit}
              className="gap-1.5 mt-1"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit mission
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  )
}

function CreateMissionDialog({
  open,
  initialBody,
  onClose,
  onCreated,
}: {
  open: boolean
  /**
   * Optional pre-filled body (e.g. from a "Draft with Kody" chat). When
   * provided, replaces the default MISSION_TEMPLATE starter.
   */
  initialBody?: string | null
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
      setBody(initialBody && initialBody.trim() ? initialBody : MISSION_TEMPLATE)
    }
  }, [open, initialBody])

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
  const updateMutation = useUpdateMission(mission.slug, githubUser?.login)

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
          <DialogTitle>Edit mission `{mission.slug}`</DialogTitle>
          <DialogDescription>
            Update the mission&apos;s title or body. Saving commits the file to the default branch.
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
