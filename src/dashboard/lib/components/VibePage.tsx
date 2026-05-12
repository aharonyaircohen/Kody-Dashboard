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
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import Link from 'next/link'
import {
  Bell,
  Bot,
  ExternalLink,
  FileText,
  Github,
  KeyRound,
  Layers,
  ListChecks,
  Loader2,
  LogOut,
  RefreshCw,
  Settings as SettingsIcon,
  Settings2,
  Sparkles,
} from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@dashboard/ui/avatar'
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
import { useBrowserNotifications } from '../hooks/useBrowserNotifications'
import { useNotificationStore } from '../notifications/useNotificationStore'
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
import { KodyHeader } from './KodyHeader'
import { BranchCleanupDialog } from './BranchCleanupDialog'
import { SimpleTooltip } from './SimpleTooltip'

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
  const { githubUser, connectedRepo, clearGitHubUser } = useGitHubIdentity()
  const { setScope } = useChatScope()

  // Notification store + permission, owned here so KodyHeader stays stateless.
  const notificationStore = useNotificationStore()
  const {
    permission: notificationPermission,
    isSupported: notificationsSupported,
    requestPermission,
  } = useBrowserNotifications({ store: notificationStore })

  const [showBranchCleanup, setShowBranchCleanup] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)

  // Selection is URL-driven (`/vibe?issue=N`) so refreshes and shared
  // links restore the same view. Local state mirrors the URL for fast
  // reads inside this render; router.replace keeps both in sync.
  const router = useRouter()
  const pathname = usePathname() ?? '/vibe'
  const searchParams = useSearchParams()
  const issueParam = searchParams?.get('issue') ?? null
  const parsedIssue = issueParam ? Number.parseInt(issueParam, 10) : NaN
  const urlIssueNumber: number | null =
    Number.isFinite(parsedIssue) && parsedIssue > 0 ? parsedIssue : null

  const [selectedIssueNumber, setSelectedIssueNumberState] = useState<
    number | null
  >(urlIssueNumber)

  // Keep state aligned with URL changes (browser back/forward, deep links).
  useEffect(() => {
    setSelectedIssueNumberState(urlIssueNumber)
  }, [urlIssueNumber])

  const setSelectedIssueNumber = useCallback(
    (next: number | null) => {
      setSelectedIssueNumberState(next)
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      if (next === null) params.delete('issue')
      else params.set('issue', String(next))
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, searchParams],
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
      {/* Header — mirrors the Dashboard so navigation feels like a view
          toggle. The VibeToggle in the header reflects "on" via pathname. */}
      <KodyHeader
        notificationStore={notificationStore}
        notificationPermission={notificationPermission}
        notificationsSupported={notificationsSupported}
        onRequestNotificationPermission={requestPermission}
        onPublished={(n) => setSelectedIssueNumber(n)}
        onOpenBranchCleanup={() => setShowBranchCleanup(true)}
        onOpenMobileMenu={() => setShowMobileMenu(true)}
        onRefresh={() => {
          tasksQuery.refetch()
        }}
        isFetching={tasksQuery.isFetching}
        desktopExtras={
          selectedTask?.associatedPR ? (
            <div className="flex items-center gap-2 min-w-0 mr-1">
              <span className="text-xs text-zinc-500 truncate hidden lg:inline max-w-[220px]">
                #{selectedTask.issueNumber} {selectedTask.title}
              </span>
              <CIStatusBadge prNumber={selectedTask.associatedPR.number} />
            </div>
          ) : null
        }
        mobileExtras={
          <SimpleTooltip content="Open issues">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMobileIssuesOpen(true)}
              aria-label="Open issues"
            >
              <ListChecks className="w-4 h-4" />
            </Button>
          </SimpleTooltip>
        }
      />

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

      {/* Branch cleanup — shared dialog driven by the Cleanup button in KodyHeader. */}
      <BranchCleanupDialog
        open={showBranchCleanup}
        onClose={() => setShowBranchCleanup(false)}
      />

      {/* Mobile menu — minimal, vibe-flavored nav (no dashboard filters). */}
      <Sheet open={showMobileMenu} onOpenChange={setShowMobileMenu}>
        <SheetContent
          side="right"
          className="w-[88vw] sm:w-[360px] !p-0 !gap-0 overflow-y-auto bg-black/95 border-white/[0.08]"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Menu</SheetTitle>
            <SheetDescription>
              Vibe navigation, identity, and quick actions.
            </SheetDescription>
          </SheetHeader>

          {(githubUser || connectedRepo) && (
            <div className="px-4 pt-4">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                {githubUser ? (
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarImage
                      src={githubUser.avatar_url}
                      alt={githubUser.login}
                    />
                    <AvatarFallback>
                      {githubUser.login[0]?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <Github className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    {githubUser ? `@${githubUser.login}` : 'Connected'}
                  </div>
                  {connectedRepo && (
                    <div className="text-[11px] text-muted-foreground truncate">
                      {connectedRepo}
                    </div>
                  )}
                </div>
                {githubUser && (
                  <SimpleTooltip content="Sign out">
                    <button
                      type="button"
                      onClick={() => {
                        clearGitHubUser()
                        setShowMobileMenu(false)
                      }}
                      className="shrink-0 h-8 w-8 rounded-md inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
                      aria-label="Sign out"
                    >
                      <LogOut className="w-4 h-4" />
                    </button>
                  </SimpleTooltip>
                )}
              </div>
            </div>
          )}

          {/* Vibe toggle — currently ON, single click goes back to dashboard. */}
          <div className="px-4 pt-3">
            <Link
              href="/"
              role="switch"
              aria-checked={true}
              onClick={() => setShowMobileMenu(false)}
              className={cn(
                'flex items-center gap-3 h-12 px-4 rounded-xl border transition-colors',
                'border-fuchsia-400/40 bg-fuchsia-500/15 text-fuchsia-100',
                'hover:bg-fuchsia-500/20',
              )}
            >
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-fuchsia-500/30">
                <Sparkles className="w-4 h-4 text-fuchsia-200" />
              </span>
              <span className="text-sm font-medium flex-1">Turn off Vibe</span>
              <span className="text-[11px] text-fuchsia-200/70">Back to list</span>
            </Link>
          </div>

          {/* Workspace — Issues picker + Jobs/Reports tiles. */}
          <div className="px-4 pt-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mb-2 px-1">
              Workspace
            </div>
            <button
              type="button"
              onClick={() => {
                setShowMobileMenu(false)
                setMobileIssuesOpen(true)
              }}
              className="flex items-center gap-3 h-12 w-full px-3 rounded-lg hover:bg-white/[0.04] transition-colors"
            >
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/10">
                <ListChecks className="w-4 h-4 text-emerald-300" />
              </span>
              <span className="text-sm font-medium">Open issues</span>
            </button>

            <div className="grid grid-cols-2 gap-2 mt-2">
              <Link
                href="/jobs"
                onClick={() => setShowMobileMenu(false)}
                className="flex flex-col items-start gap-2 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-amber-500/10">
                  <Layers className="w-4 h-4 text-amber-300" />
                </span>
                <span className="text-sm font-medium">Jobs</span>
                <span className="text-[11px] text-muted-foreground">
                  Run and edit
                </span>
              </Link>
              <Link
                href="/jobs?tab=reports"
                onClick={() => setShowMobileMenu(false)}
                className="flex flex-col items-start gap-2 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-sky-500/10">
                  <FileText className="w-4 h-4 text-sky-300" />
                </span>
                <span className="text-sm font-medium">Reports</span>
                <span className="text-[11px] text-muted-foreground">
                  Job outputs
                </span>
              </Link>
            </div>
          </div>

          {/* Settings — same set as the dashboard mobile menu. */}
          <div className="px-4 pt-4 pb-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mb-2 px-1">
              Settings
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden divide-y divide-white/[0.04]">
              {[
                {
                  href: '/notifications',
                  label: 'Notifications',
                  icon: Bell,
                  tint: 'text-amber-300 bg-amber-500/10',
                },
                {
                  href: '/secrets',
                  label: 'Secrets',
                  icon: KeyRound,
                  tint: 'text-rose-300 bg-rose-500/10',
                },
                {
                  href: '/variables',
                  label: 'Variables',
                  icon: Settings2,
                  tint: 'text-indigo-300 bg-indigo-500/10',
                },
                {
                  href: '/models',
                  label: 'Chat Models',
                  icon: Bot,
                  tint: 'text-emerald-300 bg-emerald-500/10',
                },
                {
                  href: '/repos',
                  label: 'Repositories',
                  icon: Github,
                  tint: 'text-zinc-300 bg-white/[0.08]',
                },
                {
                  href: '/settings',
                  label: 'Settings',
                  icon: SettingsIcon,
                  tint: 'text-sky-300 bg-sky-500/10',
                },
              ].map((item) => {
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setShowMobileMenu(false)}
                    className="flex items-center gap-3 h-12 px-3 hover:bg-white/[0.04] transition-colors"
                  >
                    <span
                      className={cn(
                        'inline-flex h-7 w-7 items-center justify-center rounded-md',
                        item.tint,
                      )}
                    >
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="text-sm font-medium flex-1">
                      {item.label}
                    </span>
                  </Link>
                )
              })}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
