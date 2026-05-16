/**
 * @fileType component
 * @domain kody
 * @pattern worker-control-page
 * @ai-summary Worker Control — list, view, create, edit, and delete workers.
 *   A worker is a markdown file at `.kody/workers/<slug>.md` in the
 *   connected repo whose body describes the worker's intent, allowed
 *   commands, and restrictions. Duplicated from JobControl.tsx; the chat
 *   rail reuses the existing job/job-draft scope kinds (Worker is
 *   structurally identical to Job).
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Calendar,
  Clock,
  ExternalLink,
  FileText,
  Pencil,
  Play,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Sparkles,
  Target,
  Timer,
  Trash2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "@dashboard/ui/button";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@dashboard/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dashboard/ui/select";
import { AuthGuard } from "../auth-guard";
import { cn } from "../utils";
import {
  useCreateWorker,
  useDeleteWorker,
  useWorkers,
  useRunWorker,
  useUpdateWorker,
} from "../hooks/useWorkers";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { useNow } from "../hooks/useNow";
import { formatDuration, formatRelativePast } from "../workers-schedule";
import {
  ALL_SCHEDULE_EVERY_OPTIONS,
  scheduleEveryLabel,
} from "../workers-frontmatter";
import type { Worker, WorkerSchedule } from "../api";
import { WORKER_TEMPLATE } from "../worker-template";
import { ConfirmDialog } from "./ConfirmDialog";
import { MarkdownEditor } from "./MarkdownEditor";
import { PageHeader } from "./PageShell";
import { useChatScope } from "./ChatRailShell";

function newDraftId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface WorkerControlProps {
  /** Render without the built-in PageHeader (e.g. when hosted in WorkersPageTabs). */
  embedded?: boolean;
}

export function WorkerControl({ embedded = false }: WorkerControlProps = {}) {
  return (
    <AuthGuard>
      <WorkerControlInner embedded={embedded} />
    </AuthGuard>
  );
}

export function WorkerControlInner({
  embedded = false,
}: WorkerControlProps = {}) {
  const {
    data: workers = [],
    isLoading,
    isFetching,
    refetch,
    error,
  } = useWorkers();

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingWorker, setEditingWorker] = useState<Worker | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Worker | null>(null);
  const [pendingRun, setPendingRun] = useState<Worker | null>(null);

  // Chat-panel state. The left rail switches between three modes:
  //  • worker mode   — when a worker is selected and we're not drafting
  //  • draft mode     — when "Draft new worker" is active (rotates draftId)
  //  • disabled       — neither (e.g. no workers yet)
  // `draftPrefill` carries an assistant reply the user picked via
  // "Use as worker" into CreateWorkerDialog.
  const [isDrafting, setIsDrafting] = useState(false);
  const [draftId, setDraftId] = useState<string>(() => newDraftId());
  const [draftPrefill, setDraftPrefill] = useState<string | null>(null);
  const startNewDraft = () => {
    setIsDrafting(true);
    setDraftId(newDraftId());
  };
  const cancelDraft = () => setIsDrafting(false);

  const selectedWorker = useMemo(
    () => workers.find((m) => m.slug === selectedSlug) ?? null,
    [workers, selectedSlug],
  );

  useEffect(() => {
    if (!selectedSlug && workers.length > 0) {
      setSelectedSlug(workers[0].slug);
    }
  }, [workers, selectedSlug]);

  const { githubUser } = useGitHubIdentity();
  const deleteMutation = useDeleteWorker(githubUser?.login);
  const runMutation = useRunWorker();

  // Push chat context up to the persistent rail in the root layout.
  // Worker is structurally identical to Job, so we reuse the existing
  // job / job-draft scope kinds — the chat just needs the file's
  // title/body to answer questions or draft a new one.
  const { setScope } = useChatScope();
  useEffect(() => {
    setScope(
      isDrafting
        ? {
            kind: "job-draft",
            draftId,
            onFinalize: (assistantContent) => {
              setDraftPrefill(assistantContent);
              setShowCreate(true);
            },
          }
        : selectedWorker
          ? { kind: "job", job: selectedWorker }
          : null,
    );
    return () => setScope(null);
  }, [isDrafting, draftId, selectedWorker, setScope]);

  return (
    <div className="h-full bg-black/95 text-white/90 flex flex-col overflow-hidden">
      {/* Chat rail + sidebar come from the root layout (ChatRailShell). */}
      <div className="flex-1 min-w-0 h-full overflow-hidden flex flex-col">
        {embedded ? (
          <div className="shrink-0 flex items-center justify-end gap-2 px-4 md:px-6 py-2 border-b border-white/[0.06] bg-black/20">
            <span className="text-xs text-muted-foreground mr-auto">
              {workers.length} {workers.length === 1 ? "worker" : "workers"}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label="Refresh workers"
            >
              <RefreshCw
                className={cn("w-4 h-4", isFetching && "animate-spin")}
              />
            </Button>
            {isDrafting ? (
              <Button
                variant="outline"
                size="sm"
                onClick={cancelDraft}
                className="gap-1"
                title="Stop drafting; chat returns to the selected worker"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Back to worker</span>
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={startNewDraft}
                className="gap-1"
                title="Chat with Kody to scope a brand-new worker"
              >
                <Sparkles className="w-4 h-4" />
                <span className="hidden sm:inline">Draft new</span>
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => setShowCreate(true)}
              className="gap-1"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New worker</span>
            </Button>
          </div>
        ) : (
          <PageHeader
            title="Worker Control"
            icon={Target}
            iconClassName="text-emerald-400"
            subtitle={`${workers.length} ${workers.length === 1 ? "worker" : "workers"}`}
            actions={
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetch()}
                  disabled={isFetching}
                  aria-label="Refresh workers"
                >
                  <RefreshCw
                    className={cn("w-4 h-4", isFetching && "animate-spin")}
                  />
                </Button>
                {isDrafting ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={cancelDraft}
                    className="gap-1"
                    title="Stop drafting; chat returns to the selected worker"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span className="hidden sm:inline">Back to worker</span>
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={startNewDraft}
                    className="gap-1"
                    title="Chat with Kody to scope a brand-new worker"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span className="hidden sm:inline">Draft new</span>
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => setShowCreate(true)}
                  className="gap-1"
                >
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline">New worker</span>
                </Button>
              </>
            }
          />
        )}

        {error ? (
          <div className="shrink-0 px-4 py-3 bg-red-500/10 border-b border-red-500/20 text-sm text-red-400">
            Failed to load workers: {(error as Error).message}
          </div>
        ) : null}

        <div className="flex-1 min-h-0 flex">
          {/* Middle: worker list */}
          <aside
            className={cn(
              "w-full md:w-80 md:border-r md:border-border overflow-y-auto",
              selectedWorker && "hidden md:block",
            )}
          >
            {isLoading ? (
              <EmptyState icon={<FileText />} title="Loading workers…" />
            ) : workers.length === 0 ? (
              <EmptyState
                icon={<Target />}
                title="No workers yet"
                hint="Create your first worker to describe the intent, system prompt, and restrictions."
              />
            ) : (
              <ul className="divide-y divide-border">
                {workers.map((worker) => {
                  const isActive = selectedSlug === worker.slug;
                  return (
                    <li key={worker.slug}>
                      <button
                        type="button"
                        onClick={() => setSelectedSlug(worker.slug)}
                        className={cn(
                          "w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors relative",
                          isActive && "bg-accent/70",
                          worker.disabled && "opacity-60",
                        )}
                      >
                        {isActive ? (
                          <span className="absolute inset-y-0 left-0 w-0.5 bg-emerald-400" />
                        ) : null}
                        <div className="flex items-center gap-2">
                          <Target
                            className={cn(
                              "w-3.5 h-3.5 shrink-0",
                              isActive
                                ? "text-emerald-400"
                                : "text-muted-foreground",
                            )}
                          />
                          <span className="font-medium text-sm truncate flex-1">
                            {worker.title}
                          </span>
                          {worker.disabled ? (
                            <span
                              className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-white/[0.06] text-muted-foreground border border-white/[0.08]"
                              title="Scheduler skips this worker. Manual Run still works."
                            >
                              <PowerOff className="w-2.5 h-2.5" />
                              Disabled
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                          <span className="font-mono opacity-80">
                            {worker.slug}
                          </span>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(worker.updatedAt).toLocaleDateString()}
                          </span>
                          <ScheduleInline schedule={worker.schedule} />
                          <LastTickInline lastTickAt={worker.lastTickAt} />
                          {!worker.disabled ? (
                            <NextRunInline
                              nextEligibleAt={worker.nextEligibleAt}
                              schedule={worker.schedule}
                            />
                          ) : null}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          {/* Right: worker detail */}
          <section
            className={cn(
              "flex-1 min-w-0 overflow-y-auto",
              !selectedWorker && "hidden md:block",
            )}
          >
            {selectedWorker ? (
              <WorkerDetail
                worker={selectedWorker}
                onBack={() => setSelectedSlug(null)}
                onEdit={() => setEditingWorker(selectedWorker)}
                onDelete={() => setPendingDelete(selectedWorker)}
                onRun={() => setPendingRun(selectedWorker)}
                isRunning={
                  runMutation.isPending &&
                  runMutation.variables?.slug === selectedWorker.slug
                }
              />
            ) : (
              <EmptyState
                icon={<Target />}
                title="Select a worker"
                hint="Pick a worker from the list to see its intent and system prompt."
              />
            )}
          </section>
        </div>

        {/* Create */}
        <CreateWorkerDialog
          open={showCreate}
          initialBody={draftPrefill}
          onClose={() => {
            setShowCreate(false);
            setDraftPrefill(null);
          }}
          onCreated={(worker) => {
            setSelectedSlug(worker.slug);
            setShowCreate(false);
            setDraftPrefill(null);
            // Drop out of draft mode so the chat is now scoped to the
            // newly-created worker instead of the old draft session.
            setIsDrafting(false);
          }}
        />

        {/* Edit */}
        {editingWorker ? (
          <EditWorkerDialog
            worker={editingWorker}
            onClose={() => setEditingWorker(null)}
            onSaved={() => setEditingWorker(null)}
          />
        ) : null}

        {/* Run confirm */}
        <ConfirmDialog
          open={!!pendingRun}
          title="Run this worker now?"
          description={
            pendingRun
              ? `Triggers "${pendingRun.title}" (${pendingRun.slug}) immediately, bypassing its cadence guard. GitHub Actions minutes will be used. The worker's output goes to its own report or the artifacts the body declares.`
              : ""
          }
          confirmLabel="Run now"
          onConfirm={() => {
            if (!pendingRun) return;
            runMutation.mutate({ slug: pendingRun.slug, force: true });
          }}
          onClose={() => setPendingRun(null)}
        />

        {/* Delete confirm */}
        <ConfirmDialog
          open={!!pendingDelete}
          title="Delete this worker?"
          description={
            pendingDelete
              ? `Worker "${pendingDelete.title}" (${pendingDelete.slug}) will be removed from .kody/workers/ via a commit on the default branch.`
              : ""
          }
          variant="destructive"
          confirmLabel="Delete worker"
          onConfirm={() => {
            if (!pendingDelete) return;
            const target = pendingDelete;
            deleteMutation.mutate(target.slug, {
              onSuccess: () => {
                if (selectedSlug === target.slug) setSelectedSlug(null);
              },
            });
          }}
          onClose={() => setPendingDelete(null)}
        />
      </div>
    </div>
  );
}

function WorkerDetail({
  worker,
  onBack,
  onEdit,
  onDelete,
  onRun,
  isRunning,
}: {
  worker: Worker;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRun: () => void;
  isRunning: boolean;
}) {
  const hasBody = worker.body.trim().length > 0;
  const { githubUser } = useGitHubIdentity();
  const updateMutation = useUpdateWorker(worker.slug, githubUser?.login);
  const isToggling = updateMutation.isPending;
  const toggleDisabled = () => {
    if (isToggling) return;
    updateMutation.mutate({ disabled: !worker.disabled });
  };
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
            All workers
          </Button>
          <header className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="inline-flex items-center gap-2 text-xs text-emerald-400 font-medium uppercase tracking-wider">
                <Target className="w-3.5 h-3.5" />
                Worker
              </div>
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight break-words inline-flex items-center gap-3 flex-wrap">
                <span>{worker.title}</span>
                {worker.disabled ? (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wide bg-white/[0.06] text-muted-foreground border border-white/[0.08]"
                    title="Scheduler skips this worker. Manual Run still works."
                  >
                    <PowerOff className="w-3 h-3" />
                    Disabled
                  </span>
                ) : null}
              </h1>
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                <span className="font-mono opacity-80">{worker.slug}</span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  updated {new Date(worker.updatedAt).toLocaleDateString()}
                </span>
                <ScheduleInline schedule={worker.schedule} />
                <LastTickDetail lastTickAt={worker.lastTickAt} />
                {!worker.disabled ? (
                  <NextRunDetail
                    nextEligibleAt={worker.nextEligibleAt}
                    schedule={worker.schedule}
                  />
                ) : null}
                <span>·</span>
                <a
                  href={worker.htmlUrl}
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
                className="w-9 px-0 bg-emerald-600 hover:bg-emerald-700 text-white"
                title={isRunning ? "Dispatching…" : "Run worker now"}
                aria-label="Run worker now"
              >
                <Play className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={toggleDisabled}
                disabled={isToggling}
                title={
                  worker.disabled
                    ? "Enable scheduler (auto-ticks resume)"
                    : "Disable scheduler (manual Run still works)"
                }
                aria-label={
                  worker.disabled
                    ? "Enable worker scheduler"
                    : "Disable worker scheduler"
                }
                className={cn("w-9 px-0", worker.disabled && "text-amber-400")}
              >
                {worker.disabled ? (
                  <PowerOff className="w-3.5 h-3.5" />
                ) : (
                  <Power className="w-3.5 h-3.5" />
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onEdit}
                className="w-9 px-0"
                title="Edit worker"
                aria-label="Edit worker"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onDelete}
                className="w-9 px-0 text-red-400"
                title="Delete worker"
                aria-label="Delete worker"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </header>

          {/* Description card inside the hero when present */}
          {hasBody ? (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 md:p-5">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{worker.body}</ReactMarkdown>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Empty body fallback below the hero */}
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
                describe the worker&apos;s intent, system prompt, allowed
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
              Edit worker
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function CreateWorkerDialog({
  open,
  initialBody,
  onClose,
  onCreated,
}: {
  open: boolean;
  /**
   * Optional pre-filled body (e.g. from a "Draft with Kody" chat). When
   * provided, replaces the default WORKER_TEMPLATE starter.
   */
  initialBody?: string | null;
  onClose: () => void;
  onCreated: (worker: Worker) => void;
}) {
  const { githubUser } = useGitHubIdentity();
  const createMutation = useCreateWorker(githubUser?.login);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState(WORKER_TEMPLATE);
  const [schedule, setSchedule] = useState<WorkerSchedule | null>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setBody(initialBody && initialBody.trim() ? initialBody : WORKER_TEMPLATE);
      setSchedule(null);
    }
  }, [open, initialBody]);

  const handleSubmit = () => {
    if (!title.trim() || createMutation.isPending) return;
    createMutation.mutate(
      { title: title.trim(), body, schedule },
      {
        onSuccess: (worker) => onCreated(worker),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New worker</DialogTitle>
          <DialogDescription>
            Describe the worker&apos;s intent, system prompt, allowed commands,
            and restrictions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="worker-title">Title</Label>
            <Input
              id="worker-title"
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
            {createMutation.isPending ? "Creating…" : "Create worker"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditWorkerDialog({
  worker,
  onClose,
  onSaved,
}: {
  worker: Worker;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { githubUser } = useGitHubIdentity();
  const updateMutation = useUpdateWorker(worker.slug, githubUser?.login);

  const [title, setTitle] = useState(worker.title);
  const [body, setBody] = useState(worker.body || "");
  const [schedule, setSchedule] = useState<WorkerSchedule | null>(
    worker.schedule,
  );

  useEffect(() => {
    setTitle(worker.title);
    setBody(worker.body || "");
    setSchedule(worker.schedule);
  }, [worker]);

  const handleSubmit = () => {
    if (!title.trim() || updateMutation.isPending) return;
    const patch: {
      title?: string;
      body?: string;
      schedule?: WorkerSchedule | null;
    } = {};
    if (title !== worker.title) patch.title = title.trim();
    if (body !== worker.body) patch.body = body;
    if (schedule !== worker.schedule) patch.schedule = schedule;
    if (Object.keys(patch).length === 0) {
      onSaved();
      return;
    }
    updateMutation.mutate(patch, { onSuccess: () => onSaved() });
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit worker `{worker.slug}`</DialogTitle>
          <DialogDescription>
            Update the worker&apos;s title or body. Saving commits the file to
            the default branch.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-worker-title">Title</Label>
            <Input
              id="edit-worker-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <ScheduleSelect value={schedule} onChange={setSchedule} />
          <WorkerTimingReadout
            lastTickAt={worker.lastTickAt}
            nextEligibleAt={worker.nextEligibleAt}
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
            {updateMutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Inline "last run" pill for use in the worker-list rows. Hidden when
 * the worker has never run — keeps the row dense. Refreshes every 30s.
 * Source is the commit timestamp of the sibling `<slug>.state.json`,
 * which the engine writes only when a tick actually acts.
 */
function LastTickInline({ lastTickAt }: { lastTickAt: string | null }) {
  const now = useNow(30_000);
  if (!lastTickAt) return null;
  const date = new Date(lastTickAt);
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
  );
}

/**
 * Inline "next run in X" pill — the actual next-eligible time the worker
 * will act, sourced from `data.nextEligibleISO` in the worker's state JSON.
 * Hidden when the value is missing or when the schedule is `manual`.
 */
function NextRunInline({
  nextEligibleAt,
  schedule,
}: {
  nextEligibleAt: string | null;
  schedule: WorkerSchedule | null;
}) {
  const now = useNow(30_000);
  if (schedule === "manual") return null;
  if (!nextEligibleAt) return null;
  const date = new Date(nextEligibleAt);
  const diffMs = date.getTime() - now.getTime();
  const isFuture = diffMs > 0;
  const label = isFuture
    ? `next run in ${formatDuration(diffMs)}`
    : "next run due now";
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
  );
}

/**
 * Detail-header counterpart for `NextRunInline`. Hides when the value
 * is missing or the schedule is `manual`.
 */
function NextRunDetail({
  nextEligibleAt,
  schedule,
}: {
  nextEligibleAt: string | null;
  schedule: WorkerSchedule | null;
}) {
  const now = useNow(30_000);
  if (schedule === "manual") return null;
  if (!nextEligibleAt) return null;
  const date = new Date(nextEligibleAt);
  const diffMs = date.getTime() - now.getTime();
  const label =
    diffMs > 0 ? `next run in ${formatDuration(diffMs)}` : "next run due now";
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
  );
}

/**
 * Detail-header counterpart for `LastTickInline`. Hides when the value
 * is missing.
 */
function LastTickDetail({ lastTickAt }: { lastTickAt: string | null }) {
  const now = useNow(30_000);
  if (!lastTickAt) return null;
  const date = new Date(lastTickAt);
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
  );
}

/**
 * Schedule dropdown — full cadence list:
 *
 * - **Auto** (sentinel `null`, no frontmatter): the engine ticks the worker
 *   on every cron wake; the body's cadence guard decides whether to act.
 * - Every explicit cadence (`15m` … `7d`): the engine gates ticks to that
 *   interval via the frontmatter `every:` field.
 * - **Manual only** (`every: manual`): the engine skips auto-ticks; the
 *   worker runs only when the Run button is clicked.
 */
function ScheduleSelect({
  value,
  onChange,
}: {
  value: WorkerSchedule | null;
  onChange: (next: WorkerSchedule | null) => void;
}) {
  // Sentinel because Radix Select.Item disallows empty-string values; we
  // can't bind `null` directly to it.
  const AUTO = "__auto__";
  return (
    <div className="space-y-1.5">
      <Label htmlFor="worker-schedule">Schedule</Label>
      <Select
        value={value ?? AUTO}
        onValueChange={(v) =>
          onChange(v === AUTO ? null : (v as WorkerSchedule))
        }
      >
        <SelectTrigger id="worker-schedule" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO}>Auto</SelectItem>
          {ALL_SCHEDULE_EVERY_OPTIONS.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt === "manual"
                ? "Manual only"
                : `Every ${scheduleEveryLabel(opt).replace(/^every /, "")}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        <strong>Auto</strong> — the body's cadence guard decides when to run. A
        fixed cadence gates ticks to that interval.{" "}
        <strong>Manual only</strong> — never auto-runs; click Run to trigger.
      </p>
    </div>
  );
}

/**
 * Read-only timing readout shown inside the Edit dialog: last actual run
 * + next eligible run, both sourced from the worker's state file.
 * Refreshes every 30s.
 */
function WorkerTimingReadout({
  lastTickAt,
  nextEligibleAt,
}: {
  lastTickAt: string | null;
  nextEligibleAt: string | null;
}) {
  const now = useNow(30_000);
  const last = lastTickAt ? new Date(lastTickAt) : null;
  const next = nextEligibleAt ? new Date(nextEligibleAt) : null;
  const nextLabel = next
    ? (() => {
        const diff = next.getTime() - now.getTime();
        return diff > 0
          ? `next run in ${formatDuration(diff)}`
          : "next run due now";
      })()
    : null;
  if (!last && !next) return null;
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      {last ? (
        <span
          className="inline-flex items-center gap-1"
          title={last.toLocaleString()}
        >
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
  );
}

/** Inline schedule pill for list rows + detail header. */
function ScheduleInline({ schedule }: { schedule: WorkerSchedule | null }) {
  if (!schedule) return null;
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
  );
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 py-16 text-muted-foreground">
      <div className="w-10 h-10 mb-3 opacity-60">{icon}</div>
      <div className="text-sm font-medium text-foreground">{title}</div>
      {hint ? <p className="text-xs mt-1 max-w-xs">{hint}</p> : null}
    </div>
  );
}
