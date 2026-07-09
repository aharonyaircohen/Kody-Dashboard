/**
 * @fileType component
 * @domain kody
 * @pattern memory-manager
 * @ai-summary Operator UI for Kody memory files under state repo `memory/`.
 *   Operators can search, create, edit, and delete memories without using chat
 *   tools directly.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Brain,
  Calendar,
  ExternalLink,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@dashboard/ui/button";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";
import { slugifyTitle } from "@dashboard/lib/slug";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@dashboard/ui/dialog";
import { AuthGuard } from "../auth-guard";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useRepoScopedHref } from "../hooks/useRepoScopedHref";
import { selectionPath } from "../selection-routing";
import {
  useCreateMemory,
  useDeleteMemory,
  useMemories,
  useUpdateMemory,
} from "../hooks/useMemory";
import { cn } from "../utils";
import type { MemoryFile, MemoryType } from "../api";
import { ConfirmDialog } from "./ConfirmDialog";
import { ListSearch } from "./ListSearch";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { PageHeader } from "./PageShell";

const MEMORY_TYPES: MemoryType[] = ["user", "feedback", "project", "reference"];

const TYPE_LABEL: Record<MemoryType, string> = {
  user: "User",
  feedback: "Feedback",
  project: "Project",
  reference: "Reference",
};

const TYPE_TINT: Record<MemoryType, string> = {
  user: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  feedback: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  project: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  reference: "border-violet-500/30 bg-violet-500/10 text-violet-300",
};

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function slugifyMemoryId(value: string): string {
  return slugifyTitle(value);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

interface MemoryManagerProps {
  embedded?: boolean;
  selectedId?: string | null;
}

export function MemoryManager({
  embedded = false,
  selectedId = null,
}: MemoryManagerProps = {}) {
  return (
    <AuthGuard>
      <MemoryManagerInner embedded={embedded} selectedId={selectedId} />
    </AuthGuard>
  );
}

function MemoryManagerInner({
  embedded = false,
  selectedId = null,
}: MemoryManagerProps) {
  const router = useRouter();
  const scopedHref = useRepoScopedHref();
  const autoSelectFirst = useMediaQuery("(min-width: 768px)");
  const {
    data: fetchedMemories,
    isLoading,
    isFetching,
    refetch,
    error,
  } = useMemories();
  const memories = useMemo(() => fetchedMemories ?? [], [fetchedMemories]);
  const memoriesLoaded = fetchedMemories !== undefined;
  const { githubUser } = useGitHubIdentity();
  const deleteMutation = useDeleteMemory(githubUser?.login);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<MemoryType | "all">("all");
  const [showCreate, setShowCreate] = useState(false);
  const [editingMemory, setEditingMemory] = useState<MemoryFile | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MemoryFile | null>(null);

  const selectedMemory = useMemo(
    () => memories.find((memory) => memory.id === selectedId) ?? null,
    [memories, selectedId],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return memories.filter((memory) => {
      if (typeFilter !== "all" && memory.meta.type !== typeFilter) {
        return false;
      }
      if (!q) return true;
      return (
        memory.id.toLowerCase().includes(q) ||
        memory.meta.name.toLowerCase().includes(q) ||
        memory.meta.description.toLowerCase().includes(q) ||
        memory.body.toLowerCase().includes(q)
      );
    });
  }, [memories, search, typeFilter]);

  const existingIds = useMemo(
    () => new Set(memories.map((memory) => memory.id)),
    [memories],
  );

  useEffect(() => {
    if (isLoading || !memoriesLoaded) return;
    if (memories.length === 0) {
      if (selectedId) router.replace(scopedHref("/memory"));
      return;
    }
    if (selectedId && !memories.some((memory) => memory.id === selectedId)) {
      router.replace(scopedHref("/memory"));
      return;
    }
    if (!selectedId && autoSelectFirst) {
      router.replace(scopedHref(selectionPath("/memory", memories[0].id)));
    }
  }, [
    autoSelectFirst,
    isLoading,
    memories,
    memoriesLoaded,
    router,
    scopedHref,
    selectedId,
  ]);

  const selectMemory = (id: string | null, replace = false) => {
    const path = id ? selectionPath("/memory", id) : "/memory";
    if (replace) router.replace(scopedHref(path));
    else router.push(scopedHref(path));
  };

  const headerActions = (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => refetch()}
        disabled={isFetching}
        aria-label="Refresh memory"
      >
        <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
      </Button>
      <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1">
        <Plus className="w-4 h-4" />
        <span className="hidden sm:inline">New memory</span>
      </Button>
    </>
  );

  return (
    <div className="h-full bg-black/95 text-white/90 flex flex-col overflow-hidden">
      {embedded ? (
        <div className="shrink-0 flex items-center justify-end gap-2 px-4 md:px-6 py-2 border-b border-white/[0.06] bg-black/20">
          <span className="text-xs text-muted-foreground mr-auto">
            {memories.length} {memories.length === 1 ? "memory" : "memories"}
          </span>
          {headerActions}
        </div>
      ) : (
        <PageHeader
          title="Memory"
          icon={Brain}
          iconClassName="text-fuchsia-400"
          subtitle={`${memories.length} ${
            memories.length === 1 ? "memory" : "memories"
          }`}
          actions={headerActions}
        />
      )}

      {error ? (
        <div className="shrink-0 px-4 py-3 bg-red-500/10 border-b border-red-500/20 text-sm text-red-400">
          Failed to load memory: {(error as Error).message}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 flex">
        <aside
          className={cn(
            "w-full md:w-[22rem] md:border-r md:border-border overflow-y-auto",
            selectedMemory && "hidden md:block",
          )}
        >
          {memories.length > 0 ? (
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur px-3 md:px-4 py-2 md:py-3 border-b border-border space-y-3">
              <ListSearch
                value={search}
                onChange={setSearch}
                placeholder="Search memory..."
                ariaLabel="Search memory"
                accent="violet"
              />
              <TypeFilter value={typeFilter} onChange={setTypeFilter} />
            </div>
          ) : null}

          {isLoading ? (
            <MemoryEmptyState title="Loading memory..." />
          ) : memories.length === 0 ? (
            <MemoryEmptyState title="No memory yet" />
          ) : filtered.length === 0 ? (
            <MemoryEmptyState title="No matching memory" />
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((memory) => {
                const isActive = selectedId === memory.id;
                return (
                  <li key={memory.id}>
                    <button
                      type="button"
                      onClick={() => selectMemory(memory.id)}
                      className={cn(
                        "w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors relative",
                        isActive && "bg-accent/70",
                      )}
                    >
                      {isActive ? (
                        <span className="absolute inset-y-0 left-0 w-0.5 bg-fuchsia-400" />
                      ) : null}
                      <div className="flex items-center gap-2">
                        <Brain
                          className={cn(
                            "w-3.5 h-3.5 shrink-0",
                            isActive
                              ? "text-fuchsia-400"
                              : "text-muted-foreground",
                          )}
                        />
                        <span className="text-sm font-medium truncate flex-1">
                          {memory.meta.name}
                        </span>
                        <TypeBadge type={memory.meta.type} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {memory.meta.description}
                      </p>
                      <div className="text-xs text-muted-foreground mt-2 flex items-center gap-2">
                        <span className="font-mono truncate">{memory.id}</span>
                        <span aria-hidden="true">.</span>
                        <span>{formatDate(memory.updatedAt)}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section
          className={cn(
            "flex-1 min-w-0 overflow-y-auto",
            !selectedMemory && "hidden md:block",
          )}
        >
          {selectedMemory ? (
            <MemoryDetail
              memory={selectedMemory}
              onBack={() => selectMemory(null)}
              onEdit={() => setEditingMemory(selectedMemory)}
              onDelete={() => setPendingDelete(selectedMemory)}
            />
          ) : (
            <MemoryEmptyState title="Select a memory" />
          )}
        </section>
      </div>

      <MemoryFormDialog
        open={showCreate}
        existingIds={existingIds}
        onClose={() => setShowCreate(false)}
        onSaved={(memory) => {
          selectMemory(memory.id);
          setShowCreate(false);
        }}
      />

      {editingMemory ? (
        <MemoryFormDialog
          open={!!editingMemory}
          memory={editingMemory}
          existingIds={existingIds}
          onClose={() => setEditingMemory(null)}
          onSaved={(memory) => {
            selectMemory(memory.id);
            setEditingMemory(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete this memory?"
        description={
          pendingDelete
            ? `Memory "${pendingDelete.id}" will be removed from the state repo memory store and the index will be refreshed.`
            : ""
        }
        variant="destructive"
        confirmLabel="Delete memory"
        onConfirm={() => {
          if (!pendingDelete) return;
          const target = pendingDelete;
          deleteMutation.mutate(target.id, {
            onSuccess: () => {
              if (selectedId === target.id) selectMemory(null, true);
              setPendingDelete(null);
            },
          });
        }}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}

function TypeBadge({ type }: { type: MemoryType }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        TYPE_TINT[type],
      )}
    >
      {TYPE_LABEL[type]}
    </span>
  );
}

function TypeFilter({
  value,
  onChange,
}: {
  value: MemoryType | "all";
  onChange: (next: MemoryType | "all") => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto" role="tablist">
      {(["all", ...MEMORY_TYPES] as Array<MemoryType | "all">).map((type) => {
        const active = value === type;
        return (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(type)}
            className={cn(
              "h-7 shrink-0 rounded-md px-2 text-xs transition-colors",
              active
                ? "bg-fuchsia-500/20 text-fuchsia-200"
                : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
            )}
          >
            {type === "all" ? "All" : TYPE_LABEL[type]}
          </button>
        );
      })}
    </div>
  );
}

function MemoryDetail({
  memory,
  onBack,
  onEdit,
  onDelete,
}: {
  memory: MemoryFile;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="min-h-full">
      <div className="border-b border-white/[0.06] bg-gradient-to-b from-fuchsia-500/[0.06] via-fuchsia-500/[0.02] to-transparent">
        <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="md:hidden gap-1 -ml-2 text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            All memory
          </Button>

          <header className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl md:text-3xl font-semibold tracking-tight break-words">
                  {memory.meta.name}
                </h1>
                <TypeBadge type={memory.meta.type} />
              </div>
              <p className="text-sm text-muted-foreground max-w-2xl">
                {memory.meta.description}
              </p>
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                <span className="font-mono">{memory.id}</span>
                <span aria-hidden="true">.</span>
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  updated {formatDate(memory.updatedAt)}
                </span>
                <span aria-hidden="true">.</span>
                <a
                  href={memory.htmlUrl}
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
                title="Edit memory"
                aria-label="Edit memory"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onDelete}
                className="w-9 px-0 text-red-400"
                title="Delete memory"
                aria-label="Delete memory"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </header>

          <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4 md:p-5">
            <MarkdownPreview content={memory.body} variant="compact" />
          </div>
        </div>
      </div>
    </article>
  );
}

function MemoryEmptyState({ title }: { title: string }) {
  return (
    <div className="h-full min-h-[280px] flex items-center justify-center p-6">
      <div className="text-center space-y-3">
        <div className="w-10 h-10 mx-auto rounded-full bg-fuchsia-500/10 flex items-center justify-center">
          <Brain className="w-5 h-5 text-fuchsia-400" />
        </div>
        <p className="text-sm font-medium text-foreground">{title}</p>
      </div>
    </div>
  );
}

function MemoryFormDialog({
  open,
  memory,
  existingIds,
  onClose,
  onSaved,
}: {
  open: boolean;
  memory?: MemoryFile;
  existingIds: Set<string>;
  onClose: () => void;
  onSaved: (memory: MemoryFile) => void;
}) {
  const { githubUser } = useGitHubIdentity();
  const createMutation = useCreateMemory(githubUser?.login);
  const updateMutation = useUpdateMemory(memory?.id ?? "", githubUser?.login);
  const isEditing = !!memory;

  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<MemoryType>("project");
  const [body, setBody] = useState("");
  const [touchedId, setTouchedId] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(memory?.meta.name ?? "");
    setId(memory?.id ?? "");
    setDescription(memory?.meta.description ?? "");
    setType(memory?.meta.type ?? "project");
    setBody(memory?.body ?? "");
    setTouchedId(false);
  }, [memory, open]);

  const idError = (() => {
    if (isEditing) return null;
    if (!touchedId && !id) return null;
    if (!id) return "Required";
    if (!ID_RE.test(id)) {
      return "Use lowercase letters, digits, dashes, or underscores.";
    }
    if (existingIds.has(id)) return `"${id}" already exists`;
    return null;
  })();

  const canSave =
    name.trim().length > 0 &&
    id.trim().length > 0 &&
    !idError &&
    description.trim().length > 0 &&
    body.trim().length > 0 &&
    !createMutation.isPending &&
    !updateMutation.isPending;

  const handleSubmit = () => {
    if (!canSave) return;
    if (isEditing && memory) {
      updateMutation.mutate(
        {
          name: name.trim(),
          description: description.trim(),
          type,
          body,
        },
        { onSuccess: onSaved },
      );
      return;
    }

    createMutation.mutate(
      {
        id: id.trim(),
        name: name.trim(),
        description: description.trim(),
        type,
        body,
      },
      { onSuccess: onSaved },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit memory" : "New memory"}</DialogTitle>
          <DialogDescription>
            Memory is stored in the state repo and is injected into Kody chat
            through the generated index.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="memory-name">Name</Label>
              <Input
                id="memory-name"
                value={name}
                onChange={(event) => {
                  const next = event.target.value;
                  setName(next);
                  if (!isEditing && !touchedId) setId(slugifyMemoryId(next));
                }}
                placeholder="Code review preference"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="memory-id">ID</Label>
              <Input
                id="memory-id"
                value={id}
                onChange={(event) => {
                  setTouchedId(true);
                  setId(slugifyMemoryId(event.target.value));
                }}
                onBlur={() => setTouchedId(true)}
                disabled={isEditing}
                className="font-mono"
                placeholder="code-review-preference"
              />
              {idError ? (
                <p className="text-xs text-rose-300">{idError}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="memory-description">Description</Label>
              <Input
                id="memory-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Short hook shown in the memory index"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="memory-type">Type</Label>
              <select
                id="memory-type"
                value={type}
                onChange={(event) => setType(event.target.value as MemoryType)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              >
                {MEMORY_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {TYPE_LABEL[option]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Body</Label>
            <MarkdownEditor
              value={body}
              onChange={setBody}
              rows={10}
              placeholder="What should Kody remember?"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!canSave}>
              {isEditing ? "Save changes" : "Create memory"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
