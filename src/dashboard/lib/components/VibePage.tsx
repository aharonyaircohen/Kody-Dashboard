/**
 * @fileType component
 * @domain kody
 * @pattern vibe-page
 * @ai-summary Vibe Coding view — chat (via persistent ChatRailShell) + live
 *   preview iframe + compact issue list. Selecting an issue swaps both the
 *   chat scope and the iframe; merging an issue removes it from the list.
 *   Reuses KodyChat (root layout), PreviewActions, MergeButton, CIStatusBadge.
 *   Default preview URL persists per-repo in `.kody/dashboard.json`.
 */
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft,
  ExternalLink,
  ListChecks,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
} from 'lucide-react'

import { Button } from '@dashboard/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@dashboard/ui/sheet'
import { cn, getPreviewBypassUrl } from '../utils'
import { useChatScope } from './ChatRailShell'
import { useGitHubIdentity } from '../hooks/useGitHubIdentity'
import { useKodyTasks } from '../hooks'
import { tasksApi, getStoredAuth, redirectToLogin } from '../api'
import {
  RateLimitError,
  NoTokenError,
  SessionExpiredError,
} from '../api'
import type { KodyTask } from '../types'

import { VibeIssueList } from './VibeIssueList'
import { VibeDefaultPreviewField } from './VibeDefaultPreviewField'
import { PreviewActions } from './PreviewActions'
import { CIStatusBadge } from './CIStatusBadge'

interface DashboardConfigResponse {
  config: { version: 1; defaultPreviewUrl?: string }
}

async function fetchDashboardConfig(): Promise<DashboardConfigResponse> {
  const auth = getStoredAuth()
  if (!auth) throw new NoTokenError('No auth')
  const res = await fetch('/api/kody/dashboard-config', {
    headers: {
      'x-kody-token': auth.token,
      'x-kody-owner': auth.owner,
      'x-kody-repo': auth.repo,
    },
  })
  if (res.status === 401) {
    redirectToLogin()
    throw new SessionExpiredError('Session expired')
  }
  if (!res.ok) throw new Error(`Failed to load config (${res.status})`)
  return (await res.json()) as DashboardConfigResponse
}

async function saveDashboardConfig(
  defaultPreviewUrl: string,
  actorLogin?: string,
): Promise<DashboardConfigResponse> {
  const auth = getStoredAuth()
  if (!auth) throw new NoTokenError('No auth')
  const res = await fetch('/api/kody/dashboard-config', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-kody-token': auth.token,
      'x-kody-owner': auth.owner,
      'x-kody-repo': auth.repo,
    },
    body: JSON.stringify({ defaultPreviewUrl, actorLogin }),
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => 'Save failed')
    throw new Error(msg)
  }
  return (await res.json()) as DashboardConfigResponse
}

export function VibePage() {
  const queryClient = useQueryClient()
  const { githubUser } = useGitHubIdentity()
  const { setScope } = useChatScope()

  const [selectedIssueNumber, setSelectedIssueNumber] = useState<number | null>(
    null,
  )
  // Bump to force iframe remount on Refresh — same trick as PreviewModal.
  const [iframeKey, setIframeKey] = useState(0)
  // Same Web/Admin split as PreviewModal so vibe iterations can target /admin.
  const [previewView, setPreviewView] = useState<'web' | 'admin'>('web')
  // Mobile-only: the issue list lives in a Sheet so the preview can own
  // the screen. On desktop the Sheet stays closed; the aside renders.
  const [mobileIssuesOpen, setMobileIssuesOpen] = useState(false)

  const tasksQuery = useKodyTasks({ refetchInterval: 'auto' })
  const tasks = tasksQuery.data

  // Resolve the selected task fresh from query data on every render so
  // optimistic updates and refetches flow through without local state drift.
  const selectedTask = useMemo<KodyTask | null>(() => {
    if (selectedIssueNumber === null || !tasks) return null
    return tasks.find((t) => t.issueNumber === selectedIssueNumber) ?? null
  }, [selectedIssueNumber, tasks])

  // Push the selected task into the persistent chat rail so KodyChat
  // re-scopes its context (system prompt, attached issue, history).
  useEffect(() => {
    if (selectedTask) {
      setScope({ kind: 'task', task: selectedTask })
    } else {
      setScope(null)
    }
    // Clear scope on unmount so other pages don't inherit our selection.
    return () => setScope(null)
  }, [selectedTask, setScope])

  // ── Dashboard config (default preview URL) ──────────────────────────────
  const configQuery = useQuery({
    queryKey: ['kody-dashboard-config'],
    queryFn: fetchDashboardConfig,
    enabled: !!getStoredAuth(),
    staleTime: 5 * 60 * 1000,
    retry: (count, err) => {
      if (err instanceof RateLimitError) return false
      if (err instanceof NoTokenError) return false
      if (err instanceof SessionExpiredError) return false
      return count < 2
    },
  })
  const defaultPreviewUrl = configQuery.data?.config.defaultPreviewUrl ?? ''

  const saveConfigMutation = useMutation({
    mutationFn: (url: string) => saveDashboardConfig(url, githubUser?.login),
    onSuccess: (data) => {
      queryClient.setQueryData(['kody-dashboard-config'], data)
      toast.success('Default preview saved')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to save preview URL')
    },
  })

  // ── Merge — mirrors KodyDashboard so we get the same optimistic UX. ─────
  const mergeMutation = useMutation({
    mutationFn: (task: KodyTask) =>
      tasksApi.approveReview(task, githubUser?.login),
    onMutate: async (task) => {
      await queryClient.cancelQueries({ queryKey: ['kody-tasks'] })
      const previous = queryClient.getQueriesData<KodyTask[]>({
        queryKey: ['kody-tasks'],
      })
      queryClient.setQueriesData<KodyTask[]>({ queryKey: ['kody-tasks'] }, (old) =>
        old?.map((t) =>
          t.id === task.id ? { ...t, column: 'done' as const } : t,
        ),
      )
      return { previous }
    },
    onError: (_err, _task, context) => {
      if (context?.previous) {
        for (const [key, data] of context.previous) {
          queryClient.setQueryData(key, data)
        }
      }
      toast.error('Failed to merge PR')
    },
    onSuccess: () => {
      toast.success('PR merged')
      // The issue closes server-side — drop our selection so the empty
      // pane (default preview) shows briefly before the row disappears
      // from the list on next refetch.
      setSelectedIssueNumber(null)
      queryClient.invalidateQueries({ queryKey: ['kody-tasks'] })
    },
  })

  const mergingTaskId = mergeMutation.isPending
    ? (mergeMutation.variables as KodyTask | undefined)?.id
    : null

  const handleMerge = useCallback(async () => {
    if (!selectedTask) return
    await mergeMutation.mutateAsync(selectedTask)
  }, [selectedTask, mergeMutation])

  // ── Run Kody — explicit executor handoff. Chat models (especially Gemini)
  //    sometimes narrate the dispatch without actually posting the comment;
  //    this button bypasses the model and posts `@kody` directly via the
  //    same actions endpoint the main dashboard uses. Shows only when an
  //    issue is selected without an active PR — once a PR exists, the
  //    PreviewActions bar (merge / approve) is the next step instead.
  const runKodyMutation = useMutation({
    mutationFn: (issueNumber: number) =>
      tasksApi.execute(issueNumber, githubUser?.login),
    onSuccess: () => {
      toast.success('Kody dispatched — engine is starting in GitHub Actions')
      queryClient.invalidateQueries({ queryKey: ['kody-tasks'] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to run Kody')
    },
  })

  const handleRunKody = useCallback(() => {
    if (!selectedTask) return
    runKodyMutation.mutate(selectedTask.issueNumber)
  }, [selectedTask, runKodyMutation])

  const canRunKody = !!selectedTask && !selectedTask.associatedPR
  const isRunningKody = runKodyMutation.isPending

  // ── Preview URL resolution ──────────────────────────────────────────────
  const activePreviewUrl = selectedTask?.previewUrl ?? null
  const fallbackPreviewUrl = !selectedTask ? defaultPreviewUrl : null
  const baseUrl = activePreviewUrl ?? fallbackPreviewUrl
  // Append /admin when the user picks the Admin view — same logic as
  // PreviewModal.getPreviewUrl. Strip any trailing slash so we don't
  // end up with `//admin`.
  const previewUrl = useMemo(() => {
    if (!baseUrl) return null
    if (previewView === 'admin') {
      const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
      return `${normalized}/admin`
    }
    return baseUrl
  }, [baseUrl, previewView])
  const bypassedUrl = useMemo(
    () => getPreviewBypassUrl(previewUrl),
    [previewUrl],
  )

  // Show the default-preview editor only on the empty pane and only when
  // there's no URL yet — otherwise it'd compete with the iframe.
  const showDefaultPreviewEditor = !selectedTask && !defaultPreviewUrl

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Top bar */}
      <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] bg-black/30">
        <Button asChild variant="ghost" size="sm">
          <Link href="/" aria-label="Back to dashboard">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <Sparkles className="w-5 h-5 text-fuchsia-400 shrink-0" />
        <h1 className="text-base md:text-lg font-semibold truncate">Vibe</h1>
        <span className="text-[11px] text-white/40 truncate hidden sm:inline">
          Chat • preview • ship
        </span>
        {/* Mobile-only issue picker — desktop renders the aside instead. */}
        <Button
          variant="ghost"
          size="sm"
          className="md:hidden ml-auto gap-1.5"
          onClick={() => setMobileIssuesOpen(true)}
          aria-label="Open issues"
        >
          <ListChecks className="w-4 h-4" />
          <span className="text-xs">Issues</span>
        </Button>
        {selectedTask?.associatedPR && (
          <div className="ml-auto flex items-center gap-2 min-w-0">
            <span className="text-xs text-zinc-500 truncate hidden md:inline">
              #{selectedTask.issueNumber} {selectedTask.title}
            </span>
            <CIStatusBadge prNumber={selectedTask.associatedPR.number} />
          </div>
        )}
      </header>

      {/* Body */}
      <div className="flex-1 min-h-0 flex">
        {/* Issue list — desktop aside */}
        <aside
          className="hidden md:flex flex-col shrink-0 w-[260px] border-r border-white/[0.06] bg-black/20 overflow-y-auto"
          aria-label="Open issues"
        >
          <VibeIssueList
            tasks={tasks}
            selectedIssueNumber={selectedIssueNumber}
            onSelect={(task) =>
              setSelectedIssueNumber(task ? task.issueNumber : null)
            }
            isLoading={tasksQuery.isLoading}
          />
        </aside>

        {/* Issue list — mobile Sheet */}
        <Sheet open={mobileIssuesOpen} onOpenChange={setMobileIssuesOpen}>
          <SheetContent side="left" className="w-[300px] p-0 flex flex-col">
            <SheetHeader className="px-4 py-3 border-b border-white/[0.06] space-y-0">
              <SheetTitle className="text-sm font-semibold">Open issues</SheetTitle>
              <SheetDescription className="sr-only">
                Select an issue to load its preview and chat
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <VibeIssueList
                tasks={tasks}
                selectedIssueNumber={selectedIssueNumber}
                onSelect={(task) => {
                  setSelectedIssueNumber(task ? task.issueNumber : null)
                  setMobileIssuesOpen(false)
                }}
                isLoading={tasksQuery.isLoading}
              />
            </div>
          </SheetContent>
        </Sheet>

        {/* Preview pane */}
        <section className="flex-1 min-w-0 flex flex-col">
          {/* Preview toolbar */}
          <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-2.5 border-b border-white/[0.06] bg-black/20">
            <div className="flex items-center gap-3 min-w-0">
              <div className="text-xs text-zinc-400 truncate">
                {selectedTask ? (
                  <>
                    Preview •{' '}
                    <span className="text-zinc-300">
                      #{selectedTask.issueNumber}
                    </span>
                  </>
                ) : (
                  <>Default preview</>
                )}
              </div>
              {baseUrl && (
                <div
                  className="flex items-center gap-1"
                  role="tablist"
                  aria-label="Preview view"
                >
                  <button
                    type="button"
                    onClick={() => setPreviewView('web')}
                    role="tab"
                    aria-selected={previewView === 'web'}
                    className={cn(
                      'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
                      previewView === 'web'
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                        : 'text-zinc-400 hover:text-white hover:bg-zinc-800 border border-transparent',
                    )}
                  >
                    Web
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewView('admin')}
                    role="tab"
                    aria-selected={previewView === 'admin'}
                    className={cn(
                      'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
                      previewView === 'admin'
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                        : 'text-zinc-400 hover:text-white hover:bg-zinc-800 border border-transparent',
                    )}
                  >
                    Admin
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {canRunKody && (
                <button
                  type="button"
                  onClick={handleRunKody}
                  disabled={isRunningKody}
                  title={`Dispatch @kody run on issue #${selectedTask?.issueNumber}`}
                  aria-label="Run Kody on this issue"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md bg-fuchsia-500/15 text-fuchsia-300 hover:bg-fuchsia-500/25 border border-fuchsia-500/30 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isRunningKody ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Play className="w-3 h-3" />
                  )}
                  {isRunningKody ? 'Dispatching…' : 'Run Kody'}
                </button>
              )}
              {previewUrl && (
                <>
                  <button
                    type="button"
                    onClick={() => setIframeKey((k) => k + 1)}
                    title="Refresh preview"
                    aria-label="Refresh preview"
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white border border-zinc-700 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Refresh
                  </button>
                  <a
                    href={bypassedUrl ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/20 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Open
                  </a>
                </>
              )}
            </div>
          </div>

          {/* Iframe / empty states */}
          <div
            className={cn(
              'flex-1 min-h-0',
              previewUrl ? 'bg-white' : 'bg-zinc-950',
            )}
          >
            {previewUrl ? (
              <iframe
                key={`${previewUrl}-${iframeKey}`}
                src={bypassedUrl ?? undefined}
                title="Preview deployment"
                className="w-full h-full border-0 bg-white"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              />
            ) : showDefaultPreviewEditor ? (
              <div className="h-full flex items-center justify-center p-6">
                {configQuery.isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
                ) : (
                  <VibeDefaultPreviewField
                    value={defaultPreviewUrl}
                    onSave={async (url) => {
                      await saveConfigMutation.mutateAsync(url)
                    }}
                    isSaving={saveConfigMutation.isPending}
                  />
                )}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
                <p className="text-sm text-zinc-300">No preview yet</p>
                <p className="text-xs text-zinc-500 max-w-md">
                  Once a PR is opened for this issue, its Vercel preview will
                  appear here. Use the chat to start.
                </p>
              </div>
            )}
          </div>

          {/* Approve / merge bar — only when a task with a PR is selected. */}
          {selectedTask?.associatedPR && (
            <PreviewActions
              task={selectedTask}
              onMerge={handleMerge}
              isMerging={mergingTaskId === selectedTask.id}
              onCancelPR={() => setSelectedIssueNumber(null)}
            />
          )}
        </section>
      </div>
    </div>
  )
}
