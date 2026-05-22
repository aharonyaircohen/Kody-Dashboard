/**
 * @fileType component
 * @domain kody
 * @pattern worker-control-page
 * @ai-summary Worker Control — list, view, create, edit, and delete workers.
 *   A worker is a pure reusable PERSONA file at `.kody/workers/<slug>.md`
 *   in the connected repo: a markdown body describing the worker's intent,
 *   allowed commands, and restrictions. Workers have no schedule, no state,
 *   and no run/tick — they're personas referenced by other flows. The chat
 *   rail reuses the existing job/job-draft scope kinds (Worker is
 *   structurally identical to Job).
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Calendar,
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
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
import { AuthGuard } from "../auth-guard";
import { cn } from "../utils";
import {
  useCreateWorker,
  useDeleteWorker,
  useWorkers,
  useUpdateWorker,
} from "../hooks/useWorkers";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import type { Worker } from "../api";
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
}: {
  worker: Worker;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const hasBody = worker.body.trim().length > 0;
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
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight break-words">
                {worker.title}
              </h1>
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                <span className="font-mono opacity-80">{worker.slug}</span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  updated {new Date(worker.updatedAt).toLocaleDateString()}
                </span>
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

  useEffect(() => {
    if (open) {
      setTitle("");
      setBody(initialBody && initialBody.trim() ? initialBody : WORKER_TEMPLATE);
    }
  }, [open, initialBody]);

  const handleSubmit = () => {
    if (!title.trim() || createMutation.isPending) return;
    createMutation.mutate(
      { title: title.trim(), body },
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

  useEffect(() => {
    setTitle(worker.title);
    setBody(worker.body || "");
  }, [worker]);

  const handleSubmit = () => {
    if (!title.trim() || updateMutation.isPending) return;
    const patch: {
      title?: string;
      body?: string;
    } = {};
    if (title !== worker.title) patch.title = title.trim();
    if (body !== worker.body) patch.body = body;
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
