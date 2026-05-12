/**
 * @fileType component
 * @domain kody
 * @pattern job-control-page
 * @ai-summary Job Control — list, view, create, edit, and delete jobs.
 *   A job is a markdown file at `.kody/jobs/<slug>.md` in the
 *   connected repo whose body describes the job's intent, allowed
 *   commands, and restrictions.
 */
'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Calendar,
  Clock,
  ExternalLink,
  FileText,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  Timer,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dashboard/ui/select'
import { AuthGuard } from '../auth-guard'
import { cn } from '../utils'
import {
  useCreateJob,
  useDeleteJob,
  useJobs,
  useRunJob,
  useUpdateJob,
} from '../hooks/useJobs'
import { useGitHubIdentity } from '../hooks/useGitHubIdentity'
import { useNow } from '../hooks/useNow'
import { formatDuration, formatRelativePast } from '../jobs-schedule'
import { scheduleEveryLabel } from '../jobs-frontmatter'
import type { Job, JobSchedule } from '../api'
import { JOB_TEMPLATE } from '../job-template'
import { ConfirmDialog } from './ConfirmDialog'
import { MarkdownEditor } from './MarkdownEditor'
import { PageHeader } from './PageShell'
import { KodyChat } from './KodyChat'
import { Sidebar } from './Sidebar'

function newDraftId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function JobControl() {
  return (
    <AuthGuard>
      <JobControlInner />
    </AuthGuard>
  )
}

export function JobControlInner() {
  const { data: jobs = [], isLoading, isFetching, refetch, error } = useJobs()

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editingJob, setEditingJob] = useState<Job | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Job | null>(null)
  const [pendingRun, setPendingRun] = useState<Job | null>(null)

  // Chat-panel state. The left rail switches between three modes:
  //  • job mode  — when a job is selected and we're not drafting
  //  • draft mode    — when "Draft new job" is active (rotates draftId)
  //  • disabled      — neither (e.g. no jobs yet)
  // `draftPrefill` carries an assistant reply the user picked via
  // "Use as job" into CreateJobDialog.
  const [isDrafting, setIsDrafting] = useState(false)
  const [draftId, setDraftId] = useState<string>(() => newDraftId())
  const [draftPrefill, setDraftPrefill] = useState<string | null>(null)
  const startNewDraft = () => {
    setIsDrafting(true)
    setDraftId(newDraftId())
  }
  const cancelDraft = () => setIsDrafting(false)

  const selectedJob = useMemo(
    () => jobs.find((m) => m.slug === selectedSlug) ?? null,
    [jobs, selectedSlug],
  )

  useEffect(() => {
    if (!selectedSlug && jobs.length > 0) {
      setSelectedSlug(jobs[0].slug)
    }
  }, [jobs, selectedSlug])

  const { githubUser } = useGitHubIdentity()
  const deleteMutation = useDeleteJob(githubUser?.login)
  const runMutation = useRunJob()

  return (
    <div className="h-screen bg-black/95 text-white/90 flex overflow-hidden">
      {/* Desktop left rail: persistent chat, same pattern as
          KodyDashboard's task chat panel. The chat's context follows the
          user's intent: drafting a new job, or chatting about the
          currently selected one. Sits at full page height so its top
          aligns with the Sidebar's logo — matches PageWithChat's layout. */}
      <div className="hidden md:block w-[400px] shrink-0 border-r border-border">
        <KodyChat
          context={
            isDrafting
              ? {
                  kind: 'job-draft',
                  draftId,
                  onFinalize: (assistantContent) => {
                    setDraftPrefill(assistantContent)
                    setShowCreate(true)
                  },
                }
              : selectedJob
                ? { kind: 'job', job: selectedJob }
                : null
          }
          actorLogin={githubUser?.login}
        />
      </div>

      {/* Primary navigation — between chat and content. */}
      <Sidebar />

      {/* Content column: page header + body */}
      <div className="flex-1 min-w-0 h-full overflow-hidden flex flex-col">
        <PageHeader
          title="Job Control"
          icon={Target}
          iconClassName="text-emerald-400"
          subtitle={`${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}`}
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
                aria-label="Refresh jobs"
              >
                <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
              </Button>
              {isDrafting ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={cancelDraft}
                  className="gap-1"
                  title="Stop drafting; chat returns to the selected job"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span className="hidden sm:inline">Back to job</span>
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={startNewDraft}
                  className="gap-1"
                  title="Chat with Kody to scope a brand-new job"
                >
                  <Sparkles className="w-4 h-4" />
                  <span className="hidden sm:inline">Draft new</span>
                </Button>
              )}
              <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1">
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">New job</span>
              </Button>
            </>
          }
        />

        {error ? (
          <div className="shrink-0 px-4 py-3 bg-red-500/10 border-b border-red-500/20 text-sm text-red-400">
            Failed to load jobs: {(error as Error).message}
          </div>
        ) : null}

        <div className="flex-1 min-h-0 flex">

        {/* Middle: job list */}
        <aside
          className={cn(
            'w-full md:w-80 md:border-r md:border-border overflow-y-auto',
            selectedJob && 'hidden md:block',
          )}
        >
          {isLoading ? (
            <EmptyState icon={<FileText />} title="Loading jobs…" />
          ) : jobs.length === 0 ? (
            <EmptyState
              icon={<Target />}
              title="No jobs yet"
              hint="Create your first job to describe the intent, system prompt, and restrictions."
            />
          ) : (
            <ul className="divide-y divide-border">
              {jobs.map((job) => {
                const isActive = selectedSlug === job.slug
                return (
                  <li key={job.slug}>
                    <button
                      type="button"
                      onClick={() => setSelectedSlug(job.slug)}
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
                          {job.title}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                        <span className="font-mono opacity-80">{job.slug}</span>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(job.updatedAt).toLocaleDateString()}
                        </span>
                        <ScheduleInline schedule={job.schedule} />
                        <LastTickInline lastTickAt={job.lastTickAt} />
                        <NextRunInline
                          nextEligibleAt={job.nextEligibleAt}
                          schedule={job.schedule}
                        />
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>

        {/* Right: job detail */}
        <section
          className={cn(
            'flex-1 min-w-0 overflow-y-auto',
            !selectedJob && 'hidden md:block',
          )}
        >
          {selectedJob ? (
            <JobDetail
              job={selectedJob}
              onBack={() => setSelectedSlug(null)}
              onEdit={() => setEditingJob(selectedJob)}
              onDelete={() => setPendingDelete(selectedJob)}
              onRun={() => setPendingRun(selectedJob)}
              isRunning={
                runMutation.isPending && runMutation.variables?.slug === selectedJob.slug
              }
            />
          ) : (
            <EmptyState
              icon={<Target />}
              title="Select a job"
              hint="Pick a job from the list to see its intent and system prompt."
            />
          )}
        </section>
      </div>

      {/* Create */}
      <CreateJobDialog
        open={showCreate}
        initialBody={draftPrefill}
        onClose={() => {
          setShowCreate(false)
          setDraftPrefill(null)
        }}
        onCreated={(job) => {
          setSelectedSlug(job.slug)
          setShowCreate(false)
          setDraftPrefill(null)
          // Drop out of draft mode so the chat is now scoped to the
          // newly-created job instead of the old draft session.
          setIsDrafting(false)
        }}
      />

      {/* Edit */}
      {editingJob ? (
        <EditJobDialog
          job={editingJob}
          onClose={() => setEditingJob(null)}
          onSaved={() => setEditingJob(null)}
        />
      ) : null}

      {/* Run confirm */}
      <ConfirmDialog
        open={!!pendingRun}
        title="Run this job now?"
        description={
          pendingRun
            ? `Triggers "${pendingRun.title}" (${pendingRun.slug}) immediately, bypassing its cadence guard. GitHub Actions minutes will be used. The job's output goes to its own report or the artifacts the body declares.`
            : ''
        }
        confirmLabel="Run now"
        onConfirm={() => {
          if (!pendingRun) return
          runMutation.mutate({ slug: pendingRun.slug, force: true })
        }}
        onClose={() => setPendingRun(null)}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete this job?"
        description={
          pendingDelete
            ? `Job "${pendingDelete.title}" (${pendingDelete.slug}) will be removed from .kody/jobs/ via a commit on the default branch.`
            : ''
        }
        variant="destructive"
        confirmLabel="Delete job"
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
    </div>
  )
}

function JobDetail({
  job,
  onBack,
  onEdit,
  onDelete,
  onRun,
  isRunning,
}: {
  job: Job
  onBack: () => void
  onEdit: () => void
  onDelete: () => void
  onRun: () => void
  isRunning: boolean
}) {
  const hasBody = job.body.trim().length > 0
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
            All jobs
          </Button>
          <header className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="inline-flex items-center gap-2 text-xs text-emerald-400 font-medium uppercase tracking-wider">
                <Target className="w-3.5 h-3.5" />
                Job
              </div>
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight break-words">
                {job.title}
              </h1>
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                <span className="font-mono opacity-80">{job.slug}</span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  updated {new Date(job.updatedAt).toLocaleDateString()}
                </span>
                <ScheduleInline schedule={job.schedule} />
                <LastTickDetail lastTickAt={job.lastTickAt} />
                <NextRunDetail
                  nextEligibleAt={job.nextEligibleAt}
                  schedule={job.schedule}
                />
                <span>·</span>
                <a
                  href={job.htmlUrl}
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
                <ReactMarkdown>{job.body}</ReactMarkdown>
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
                describe the job&apos;s intent, system prompt, allowed
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
              Edit job
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  )
}

function CreateJobDialog({
  open,
  initialBody,
  onClose,
  onCreated,
}: {
  open: boolean
  /**
   * Optional pre-filled body (e.g. from a "Draft with Kody" chat). When
   * provided, replaces the default JOB_TEMPLATE starter.
   */
  initialBody?: string | null
  onClose: () => void
  onCreated: (job: Job) => void
}) {
  const { githubUser } = useGitHubIdentity()
  const createMutation = useCreateJob(githubUser?.login)

  const [title, setTitle] = useState('')
  const [body, setBody] = useState(JOB_TEMPLATE)
  const [schedule, setSchedule] = useState<JobSchedule | null>(null)

  useEffect(() => {
    if (open) {
      setTitle('')
      setBody(initialBody && initialBody.trim() ? initialBody : JOB_TEMPLATE)
      setSchedule(null)
    }
  }, [open, initialBody])

  const handleSubmit = () => {
    if (!title.trim() || createMutation.isPending) return
    createMutation.mutate(
      { title: title.trim(), body, schedule },
      {
        onSuccess: (job) => onCreated(job),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New job</DialogTitle>
          <DialogDescription>
            Describe the job&apos;s intent, system prompt, allowed commands, and restrictions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="job-title">Title</Label>
            <Input
              id="job-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Release notes manager"
              autoFocus
            />
          </div>
          <ScheduleSelect value={schedule} onChange={setSchedule} />
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
            {createMutation.isPending ? 'Creating…' : 'Create job'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EditJobDialog({
  job,
  onClose,
  onSaved,
}: {
  job: Job
  onClose: () => void
  onSaved: () => void
}) {
  const { githubUser } = useGitHubIdentity()
  const updateMutation = useUpdateJob(job.slug, githubUser?.login)

  const [title, setTitle] = useState(job.title)
  const [body, setBody] = useState(job.body || '')
  const [schedule, setSchedule] = useState<JobSchedule | null>(job.schedule)

  useEffect(() => {
    setTitle(job.title)
    setBody(job.body || '')
    setSchedule(job.schedule)
  }, [job])

  const handleSubmit = () => {
    if (!title.trim() || updateMutation.isPending) return
    const patch: { title?: string; body?: string; schedule?: JobSchedule | null } = {}
    if (title !== job.title) patch.title = title.trim()
    if (body !== job.body) patch.body = body
    if (schedule !== job.schedule) patch.schedule = schedule
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
          <DialogTitle>Edit job `{job.slug}`</DialogTitle>
          <DialogDescription>
            Update the job&apos;s title or body. Saving commits the file to the default branch.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-job-title">Title</Label>
            <Input
              id="edit-job-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <ScheduleSelect value={schedule} onChange={setSchedule} />
          <JobTimingReadout
            lastTickAt={job.lastTickAt}
            nextEligibleAt={job.nextEligibleAt}
          />
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

/**
 * Inline "last run" pill for use in the job-list rows. Hidden when
 * the job has never run — keeps the row dense. Refreshes every 30s.
 * Source is the commit timestamp of the sibling `<slug>.state.json`,
 * which the engine writes only when a tick actually acts.
 */
function LastTickInline({ lastTickAt }: { lastTickAt: string | null }) {
  const now = useNow(30_000)
  if (!lastTickAt) return null
  const date = new Date(lastTickAt)
  return (
    <>
      <span>·</span>
      <span
        className="inline-flex items-center gap-1"
        title={`Last run: ${date.toLocaleString()}`}
      >
        <Clock className="w-3 h-3" />
        last run {formatRelativePast(date, now)}
      </span>
    </>
  )
}

/**
 * Inline "next run in X" pill — the actual next-eligible time the job
 * will act, sourced from `data.nextEligibleISO` in the job's state JSON.
 * Hidden when the value is missing (job hasn't run yet, or its body
 * doesn't emit the field) or when the schedule is `manual` — in that
 * case the `ScheduleInline` pill already says "manual only", which is
 * the whole story.
 */
function NextRunInline({
  nextEligibleAt,
  schedule,
}: {
  nextEligibleAt: string | null
  schedule: JobSchedule | null
}) {
  const now = useNow(30_000)
  if (schedule === 'manual') return null
  if (!nextEligibleAt) return null
  const date = new Date(nextEligibleAt)
  const diffMs = date.getTime() - now.getTime()
  const isFuture = diffMs > 0
  const label = isFuture
    ? `next run in ${formatDuration(diffMs)}`
    : 'next run due now'
  return (
    <>
      <span>·</span>
      <span
        className="inline-flex items-center gap-1"
        title={`Next eligible run: ${date.toLocaleString()}`}
      >
        <Timer className="w-3 h-3" />
        {label}
      </span>
    </>
  )
}

/**
 * Detail-header counterpart for `NextRunInline`. Hides when the value
 * is missing or the schedule is `manual` — same reasoning as the inline
 * pill.
 */
function NextRunDetail({
  nextEligibleAt,
  schedule,
}: {
  nextEligibleAt: string | null
  schedule: JobSchedule | null
}) {
  const now = useNow(30_000)
  if (schedule === 'manual') return null
  if (!nextEligibleAt) return null
  const date = new Date(nextEligibleAt)
  const diffMs = date.getTime() - now.getTime()
  const label =
    diffMs > 0 ? `next run in ${formatDuration(diffMs)}` : 'next run due now'
  return (
    <>
      <span>·</span>
      <span
        className="inline-flex items-center gap-1"
        title={`Next eligible run: ${date.toLocaleString()}`}
      >
        <Timer className="w-3 h-3" />
        {label}
      </span>
    </>
  )
}

/**
 * Detail-header counterpart for `LastTickInline`. Hides when the value
 * is missing — `lastTickAt` is the commit timestamp of `<slug>.state.json`
 * on GitHub, which only exists for repos using the `contents-api` job-state
 * backend. Repos on `local-file` keep state on the runner only, so a null
 * value means "the dashboard can't see it", not "never run". Saying "never
 * run" misleads more than it informs.
 */
function LastTickDetail({ lastTickAt }: { lastTickAt: string | null }) {
  const now = useNow(30_000)
  if (!lastTickAt) return null
  const date = new Date(lastTickAt)
  return (
    <>
      <span>·</span>
      <span
        className="inline-flex items-center gap-1"
        title={`Last run: ${date.toLocaleString()}`}
      >
        <Clock className="w-3 h-3" />
        last run {formatRelativePast(date, now)}
      </span>
    </>
  )
}

/**
 * Schedule dropdown — two options only:
 *
 * - **Auto** (sentinel `null`, no frontmatter): the engine ticks the job
 *   on every cron wake; the body's cadence guard decides whether to act.
 *   This is the default for every job in this repo's convention.
 * - **Manual only** (`every: manual`): the engine skips auto-ticks; the
 *   job runs only when the Run button is clicked.
 *
 * Granular cadences (`every: 1d`, `every: 7d`, …) are still parsed and
 * honored by the engine if a job's frontmatter declares them, but the
 * UI doesn't expose them — the body-cadence convention makes them
 * redundant in this codebase.
 */
function ScheduleSelect({
  value,
  onChange,
}: {
  value: JobSchedule | null
  onChange: (next: JobSchedule | null) => void
}) {
  // Sentinel because Radix Select.Item disallows empty-string values; we
  // can't bind `null` directly to it.
  const AUTO = '__auto__'
  return (
    <div className="space-y-1.5">
      <Label htmlFor="job-schedule">Schedule</Label>
      <Select
        value={value === 'manual' ? 'manual' : AUTO}
        onValueChange={(v) => onChange(v === AUTO ? null : 'manual')}
      >
        <SelectTrigger id="job-schedule" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO}>Auto</SelectItem>
          <SelectItem value="manual">Manual only</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        <strong>Auto</strong> — the body's cadence guard decides when to
        run. <strong>Manual only</strong> — never auto-runs; click Run to
        trigger.
      </p>
    </div>
  )
}

/**
 * Read-only timing readout shown inside the Edit dialog: last actual run
 * + next eligible run, both sourced from the job's state file. Helpful
 * for jobs whose cadence lives in the body prose (not frontmatter), so
 * the dropdown above can't honestly express it. Refreshes every 30s.
 */
function JobTimingReadout({
  lastTickAt,
  nextEligibleAt,
}: {
  lastTickAt: string | null
  nextEligibleAt: string | null
}) {
  const now = useNow(30_000)
  const last = lastTickAt ? new Date(lastTickAt) : null
  const next = nextEligibleAt ? new Date(nextEligibleAt) : null
  const nextLabel = next
    ? (() => {
        const diff = next.getTime() - now.getTime()
        return diff > 0 ? `next run in ${formatDuration(diff)}` : 'next run due now'
      })()
    : null
  // Both signals come from `<slug>.state.json` on GitHub, which only exists
  // for repos on the `contents-api` job-state backend. Hide the readout
  // entirely when neither is reachable — saying "never run / next run
  // unknown" on every job misleads more than it informs.
  if (!last && !next) return null
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      {last ? (
        <span className="inline-flex items-center gap-1" title={last.toLocaleString()}>
          <Clock className="w-3 h-3" />
          last run {formatRelativePast(last, now)}
        </span>
      ) : null}
      {last && nextLabel && next ? <span>·</span> : null}
      {nextLabel && next ? (
        <span
          className="inline-flex items-center gap-1"
          title={next.toLocaleString()}
        >
          <Timer className="w-3 h-3" />
          {nextLabel}
        </span>
      ) : null}
    </div>
  )
}

/** Inline schedule pill for list rows + detail header. */
function ScheduleInline({ schedule }: { schedule: JobSchedule | null }) {
  if (!schedule) return null
  return (
    <>
      <span>·</span>
      <span
        className="inline-flex items-center gap-1"
        title={`Cadence: ${scheduleEveryLabel(schedule)}`}
      >
        <Timer className="w-3 h-3" />
        {scheduleEveryLabel(schedule)}
      </span>
    </>
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
