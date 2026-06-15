/**
 * @fileType component
 * @domain todos
 * @pattern todo-list-control-page
 * @ai-summary Kody todo-list UI — list, filter, view, create, edit, and delete
 * todo lists; each list owns note-like items that can be added, edited,
 * completed/reopened, and deleted.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Circle,
  ExternalLink,
  ListTodo,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "@dashboard/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@dashboard/ui/dialog";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";
import { AuthGuard } from "../auth-guard";
import type { TodoEntry, TodoItem } from "../api";
import {
  useCreateTodo,
  useDeleteTodo,
  useTodoEntries,
  useUpdateTodo,
} from "../hooks/useTodoEntries";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { cn } from "../utils";
import { ConfirmDialog } from "./ConfirmDialog";
import { ListSearch } from "./ListSearch";
import { MarkdownEditor } from "./MarkdownEditor";
import { PageHeader } from "./PageShell";

type ItemEditorState =
  | { mode: "create" }
  | { mode: "edit"; item: TodoItem }
  | null;

interface TodoControlProps {
  /** Render without built-in PageHeader (e.g. when hosted in tabs). */
  embedded?: boolean;
}

function makeItemId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `item-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function listStats(list: TodoEntry): {
  total: number;
  done: number;
  active: number;
} {
  const total = list.items.length;
  const done = list.items.filter((item) => item.completed).length;
  return { total, done, active: total - done };
}

export function TodoControl({ embedded = false }: TodoControlProps = {}) {
  return (
    <AuthGuard>
      <TodoControlInner embedded={embedded} />
    </AuthGuard>
  );
}

export function TodoControlInner({ embedded = false }: TodoControlProps = {}) {
  const {
    data: todoLists = [],
    isLoading,
    isFetching,
    refetch,
    error,
  } = useTodoEntries();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingList, setEditingList] = useState<TodoEntry | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TodoEntry | null>(null);
  const [search, setSearch] = useState("");
  const { githubUser } = useGitHubIdentity();
  const deleteMutation = useDeleteTodo(githubUser?.login);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return todoLists.filter((list) => {
      if (!q) return true;
      return (
        list.title.toLowerCase().includes(q) ||
        list.slug.toLowerCase().includes(q) ||
        list.items.some(
          (item) =>
            item.title.toLowerCase().includes(q) ||
            item.body.toLowerCase().includes(q),
        )
      );
    });
  }, [todoLists, search]);

  const selectedList = useMemo(
    () => todoLists.find((list) => list.slug === selectedSlug) ?? null,
    [todoLists, selectedSlug],
  );

  const aggregate = useMemo(() => {
    const totalItems = todoLists.reduce(
      (sum, list) => sum + list.items.length,
      0,
    );
    const activeItems = todoLists.reduce(
      (sum, list) => sum + list.items.filter((item) => !item.completed).length,
      0,
    );
    return { totalItems, activeItems };
  }, [todoLists]);

  useEffect(() => {
    if (filtered.length === 0) {
      if (selectedSlug) setSelectedSlug(null);
      return;
    }
    if (!selectedSlug || !filtered.some((list) => list.slug === selectedSlug)) {
      setSelectedSlug(filtered[0].slug);
    }
  }, [filtered, selectedSlug]);

  const headerActions = (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => refetch()}
        disabled={isFetching}
        aria-label="Refresh todo lists"
      >
        <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
      </Button>
      <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1">
        <Plus className="w-4 h-4" />
        <span className="hidden sm:inline">New list</span>
      </Button>
    </>
  );

  return (
    <div className="h-full bg-black/95 text-white/90 flex flex-col overflow-hidden">
      {embedded ? (
        <div className="shrink-0 flex items-center justify-end gap-2 px-4 md:px-6 py-2 border-b border-white/[0.06] bg-black/20">
          <span className="text-xs text-muted-foreground mr-auto">
            {aggregate.activeItems} open items · {todoLists.length} lists
          </span>
          {headerActions}
        </div>
      ) : (
        <PageHeader
          title="Todos"
          icon={ListTodo}
          iconClassName="text-emerald-400"
          subtitle={`${aggregate.activeItems} open items · ${todoLists.length} lists`}
          actions={headerActions}
        />
      )}

      {error ? (
        <div className="shrink-0 px-4 py-3 bg-red-500/10 border-b border-red-500/20 text-sm text-red-400">
          Failed to load todo lists: {(error as Error).message}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 flex">
        <aside
          className={cn(
            "w-full md:w-80 md:border-r md:border-border overflow-y-auto",
            selectedList && "hidden md:block",
          )}
        >
          {todoLists.length > 0 ? (
            <div className="sticky top-0 z-10 space-y-2 bg-background/95 backdrop-blur px-3 md:px-4 py-2 md:py-3 border-b border-border">
              <ListSearch
                value={search}
                onChange={setSearch}
                placeholder="Search lists..."
                ariaLabel="Search todo lists"
                accent="emerald"
              />
            </div>
          ) : null}

          {isLoading ? (
            <EmptyState icon={<ListTodo />} title="Loading todo lists..." />
          ) : todoLists.length === 0 ? (
            <EmptyState
              icon={<ListTodo />}
              title="No todo lists yet"
              hint="Create a list, then add the note-like items that belong inside it."
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<ListTodo />}
              title="No matching lists"
              hint="Try another search."
            />
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((list) => {
                const isActive = selectedSlug === list.slug;
                const stats = listStats(list);
                const completed =
                  list.items.length > 0 &&
                  list.items.every((item) => item.completed);
                return (
                  <li key={list.slug}>
                    <button
                      type="button"
                      onClick={() => setSelectedSlug(list.slug)}
                      className={cn(
                        "w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors relative",
                        isActive && "bg-accent/70",
                      )}
                    >
                      {isActive ? (
                        <span className="absolute inset-y-0 left-0 w-0.5 bg-emerald-400" />
                      ) : null}
                      <div className="flex items-start gap-2">
                        {completed ? (
                          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-300" />
                        ) : (
                          <ListTodo className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">
                            {list.title}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                            <span>
                              {stats.done}/{stats.total} done
                            </span>
                            <span className="font-mono">{list.slug}</span>
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {new Date(list.updatedAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
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
            !selectedList && "hidden md:block",
          )}
        >
          {selectedList ? (
            <TodoListDetail
              list={selectedList}
              onBack={() => setSelectedSlug(null)}
              onEditList={() => setEditingList(selectedList)}
              onDeleteList={() => setPendingDelete(selectedList)}
            />
          ) : (
            <EmptyState
              icon={<ListTodo />}
              title="Select a todo list"
              hint="Pick a list to manage the items inside it."
            />
          )}
        </section>
      </div>

      <CreateTodoListDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(list) => {
          setSelectedSlug(list.slug);
          setShowCreate(false);
        }}
      />

      {editingList ? (
        <EditTodoListDialog
          list={editingList}
          onClose={() => setEditingList(null)}
          onSaved={() => setEditingList(null)}
        />
      ) : null}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete todo list?"
        description={
          pendingDelete
            ? `Todo list "${pendingDelete.title}" and its ${pendingDelete.items.length} items will be removed from .kody/todos/ via commit on the default branch.`
            : ""
        }
        variant="destructive"
        confirmLabel="Delete list"
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
  );
}

function TodoListDetail({
  list,
  onBack,
  onEditList,
  onDeleteList,
}: {
  list: TodoEntry;
  onBack: () => void;
  onEditList: () => void;
  onDeleteList: () => void;
}) {
  const { githubUser } = useGitHubIdentity();
  const updateMutation = useUpdateTodo(list.slug, githubUser?.login);
  const [itemEditor, setItemEditor] = useState<ItemEditorState>(null);
  const [pendingItemDelete, setPendingItemDelete] = useState<TodoItem | null>(
    null,
  );
  const stats = listStats(list);

  const saveItems = (items: TodoItem[]) => {
    updateMutation.mutate({ items });
  };

  const toggleItem = (item: TodoItem) => {
    const completed = !item.completed;
    saveItems(
      list.items.map((candidate) =>
        candidate.id === item.id
          ? {
              ...candidate,
              completed,
              completedAt: completed ? new Date().toISOString() : null,
            }
          : candidate,
      ),
    );
  };

  const deleteItem = (item: TodoItem) => {
    saveItems(list.items.filter((candidate) => candidate.id !== item.id));
  };

  const upsertItem = (
    input: { title: string; body: string },
    item?: TodoItem,
  ) => {
    if (item) {
      updateMutation.mutate(
        {
          items: list.items.map((candidate) =>
            candidate.id === item.id
              ? { ...candidate, title: input.title, body: input.body }
              : candidate,
          ),
        },
        { onSuccess: () => setItemEditor(null) },
      );
      return;
    }

    const now = new Date().toISOString();
    updateMutation.mutate(
      {
        items: [
          ...list.items,
          {
            id: makeItemId(),
            title: input.title,
            body: input.body,
            completed: false,
            createdAt: now,
            completedAt: null,
          },
        ],
      },
      { onSuccess: () => setItemEditor(null) },
    );
  };

  return (
    <article className="min-h-full">
      <div className="border-b border-white/[0.06] bg-gradient-to-b from-emerald-500/[0.06] via-emerald-500/[0.02] to-transparent">
        <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="md:hidden gap-1 -ml-2 text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            All lists
          </Button>

          <header className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <ListTodo className="w-5 h-5 text-emerald-300 shrink-0" />
                <h1 className="text-2xl md:text-3xl font-semibold tracking-tight break-words">
                  {list.title}
                </h1>
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                <span>
                  {stats.done}/{stats.total} items complete
                </span>
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  updated {new Date(list.updatedAt).toLocaleDateString()}
                </span>
                <span>·</span>
                <a
                  href={list.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                  title="Open on GitHub"
                >
                  <ExternalLink className="w-3 h-3" />
                  GitHub
                </a>
              </div>
              <div className="rounded-md border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs">
                <span className="text-white/50">Active file </span>
                <code className="font-mono text-emerald-200">
                  {`.kody/todos/${list.slug}.md`}
                </code>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                onClick={() => setItemEditor({ mode: "create" })}
                className="gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Add item
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onEditList}
                className="w-9 px-0"
                title="Edit list"
                aria-label="Edit list"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onDeleteList}
                className="w-9 px-0 text-red-400"
                title="Delete list"
                aria-label="Delete list"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </header>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 md:p-8">
        {list.items.length === 0 ? (
          <div className="rounded-md border border-dashed border-white/[0.1] bg-white/[0.02] py-12 text-center space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                No items in this list
              </p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Add note-like items here, then mark each one complete as it is
                handled.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setItemEditor({ mode: "create" })}
              className="gap-1.5 mt-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Add item
            </Button>
          </div>
        ) : (
          <ul className="space-y-3">
            {list.items.map((item) => (
              <TodoItemCard
                key={item.id}
                item={item}
                onToggle={() => toggleItem(item)}
                onEdit={() => setItemEditor({ mode: "edit", item })}
                onDelete={() => setPendingItemDelete(item)}
                disabled={updateMutation.isPending}
              />
            ))}
          </ul>
        )}
      </div>

      <TodoItemDialog
        state={itemEditor}
        onClose={() => setItemEditor(null)}
        onSubmit={(input) =>
          upsertItem(
            input,
            itemEditor?.mode === "edit" ? itemEditor.item : undefined,
          )
        }
        isSaving={updateMutation.isPending}
      />

      <ConfirmDialog
        open={!!pendingItemDelete}
        title="Delete item?"
        description={
          pendingItemDelete
            ? `Item "${pendingItemDelete.title}" will be removed from this list.`
            : ""
        }
        variant="destructive"
        confirmLabel="Delete item"
        onConfirm={() => {
          if (pendingItemDelete) deleteItem(pendingItemDelete);
        }}
        onClose={() => setPendingItemDelete(null)}
      />
    </article>
  );
}

function TodoItemCard({
  item,
  onToggle,
  onEdit,
  onDelete,
  disabled,
}: {
  item: TodoItem;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  return (
    <li className="rounded-md border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          aria-label={item.completed ? "Reopen item" : "Complete item"}
          title={item.completed ? "Reopen item" : "Complete item"}
          className={cn(
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors",
            item.completed
              ? "text-emerald-300 hover:text-emerald-200"
              : "text-muted-foreground hover:text-emerald-300",
          )}
        >
          {item.completed ? (
            <CheckCircle2 className="w-5 h-5" />
          ) : (
            <Circle className="w-5 h-5" />
          )}
        </button>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2
                className={cn(
                  "text-sm font-semibold break-words",
                  item.completed && "text-muted-foreground line-through",
                )}
              >
                {item.title}
              </h2>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {item.completedAt
                  ? `completed ${new Date(item.completedAt).toLocaleDateString()}`
                  : `created ${new Date(item.createdAt).toLocaleDateString()}`}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={onEdit}
                className="w-8 h-8 px-0"
                title="Edit item"
                aria-label="Edit item"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onDelete}
                className="w-8 h-8 px-0 text-red-400"
                title="Delete item"
                aria-label="Delete item"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {item.body.trim() ? (
            <div className="prose prose-sm dark:prose-invert max-w-none border-t border-white/[0.06] pt-3">
              <ReactMarkdown>{item.body}</ReactMarkdown>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function CreateTodoListDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (list: TodoEntry) => void;
}) {
  const { githubUser } = useGitHubIdentity();
  const createMutation = useCreateTodo(githubUser?.login);
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<Array<{ title: string; body: string }>>(
    [],
  );
  const [touchedTitle, setTouchedTitle] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setItems([]);
      setTouchedTitle(false);
    }
  }, [open]);

  const titleError = (() => {
    if (!touchedTitle) return null;
    if (!title.trim()) return "Required";
    if (title.trim().length > 160) return "Keep title under 160 characters.";
    return null;
  })();
  const hasInvalidItem = items.some((item) => item.title.trim().length === 0);
  const canSave =
    !!title.trim() &&
    !titleError &&
    !hasInvalidItem &&
    !createMutation.isPending;

  const handleSubmit = () => {
    if (!canSave) return;
    createMutation.mutate(
      {
        title: title.trim(),
        items: items.map((item) => ({
          title: item.title.trim(),
          body: item.body,
        })),
      },
      { onSuccess: (list) => onCreated(list) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : null)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>New todo list</DialogTitle>
          <DialogDescription>
            Create a list and optionally seed it with note-like items.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="todo-list-title">List title</Label>
            <Input
              id="todo-list-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => setTouchedTitle(true)}
              placeholder="Checkout follow-ups"
              autoFocus
            />
            {titleError ? (
              <p className="text-xs text-rose-300">{titleError}</p>
            ) : null}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label>Items</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setItems((current) => [...current, { title: "", body: "" }])
                }
                className="gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Add item
              </Button>
            </div>

            {items.length === 0 ? (
              <p className="rounded-md border border-dashed border-white/[0.1] px-3 py-4 text-center text-xs text-muted-foreground">
                No initial items. You can add them now or after creating the
                list.
              </p>
            ) : (
              <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                {items.map((item, index) => (
                  <div
                    key={index}
                    className="rounded-md border border-white/[0.08] bg-white/[0.02] p-3 space-y-3"
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <Label htmlFor={`todo-create-item-${index}`}>
                          Item title
                        </Label>
                        <Input
                          id={`todo-create-item-${index}`}
                          value={item.title}
                          onChange={(event) =>
                            setItems((current) =>
                              current.map((candidate, candidateIndex) =>
                                candidateIndex === index
                                  ? { ...candidate, title: event.target.value }
                                  : candidate,
                              ),
                            )
                          }
                          placeholder="Investigate empty cart state"
                        />
                        {!item.title.trim() ? (
                          <p className="text-xs text-rose-300">Required</p>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setItems((current) =>
                            current.filter(
                              (_, candidateIndex) => candidateIndex !== index,
                            ),
                          )
                        }
                        className="mt-6 w-8 px-0 text-red-400"
                        title="Remove item"
                        aria-label="Remove item"
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Note</Label>
                      <MarkdownEditor
                        value={item.body}
                        onChange={(next) =>
                          setItems((current) =>
                            current.map((candidate, candidateIndex) =>
                              candidateIndex === index
                                ? { ...candidate, body: next }
                                : candidate,
                            ),
                          )
                        }
                        rows={5}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!canSave}>
            {createMutation.isPending ? "Creating..." : "Create list"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditTodoListDialog({
  list,
  onClose,
  onSaved,
}: {
  list: TodoEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { githubUser } = useGitHubIdentity();
  const updateMutation = useUpdateTodo(list.slug, githubUser?.login);
  const [title, setTitle] = useState(list.title);

  useEffect(() => {
    setTitle(list.title);
  }, [list]);

  const titleError = (() => {
    if (!title.trim()) return "Required";
    if (title.trim().length > 160) return "Keep title under 160 characters.";
    return null;
  })();
  const canSave = !titleError && !updateMutation.isPending;

  const handleSubmit = () => {
    if (!canSave) return;
    if (title.trim() === list.title) {
      onSaved();
      return;
    }
    updateMutation.mutate(
      { title: title.trim() },
      { onSuccess: () => onSaved() },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit list</DialogTitle>
          <DialogDescription>
            Rename the list. Items stay unchanged.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 mt-2">
          <Label htmlFor="edit-todo-list-title">List title</Label>
          <Input
            id="edit-todo-list-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
          />
          {titleError ? (
            <p className="text-xs text-rose-300">{titleError}</p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!canSave}>
            {updateMutation.isPending ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TodoItemDialog({
  state,
  onClose,
  onSubmit,
  isSaving,
}: {
  state: ItemEditorState;
  onClose: () => void;
  onSubmit: (input: { title: string; body: string }) => void;
  isSaving: boolean;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (!state) return;
    if (state.mode === "edit") {
      setTitle(state.item.title);
      setBody(state.item.body);
    } else {
      setTitle("");
      setBody("");
    }
  }, [state]);

  const titleError = !title.trim() ? "Required" : null;
  const canSave = !titleError && !isSaving;

  return (
    <Dialog open={!!state} onOpenChange={(next) => (!next ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {state?.mode === "edit" ? "Edit item" : "Add item"}
          </DialogTitle>
          <DialogDescription>
            Each item is a note with its own completed state.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="todo-item-title">Item title</Label>
            <Input
              id="todo-item-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Write regression note"
              autoFocus
            />
            {titleError ? (
              <p className="text-xs text-rose-300">{titleError}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label>Note</Label>
            <MarkdownEditor value={body} onChange={setBody} rows={10} />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => onSubmit({ title: title.trim(), body })}
            disabled={!canSave}
          >
            {isSaving ? "Saving..." : "Save item"}
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
