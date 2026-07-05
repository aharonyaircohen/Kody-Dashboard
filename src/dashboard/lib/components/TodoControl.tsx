/**
 * @fileType component
 * @domain todos
 * @pattern todo-list-control-page
 * @ai-summary Kody todo-list UI — list, filter, view, create, edit, and delete
 * todo lists; each list owns note-like items that can be added, edited,
 * completed/reopened, and deleted.
 */
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  ExternalLink,
  GripVertical,
  ListTodo,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Sparkles,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@dashboard/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@dashboard/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@dashboard/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@dashboard/ui/dropdown-menu";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";
import { AuthGuard } from "../auth-guard";
import type { TodoEntry, TodoItem } from "../api";
import type { GitHubCollaborator } from "../types";
import { useCollaborators } from "../hooks";
import {
  useCreateTodo,
  useDeleteTodo,
  useTodoEntries,
  useUpdateTodo,
} from "../hooks/useTodoEntries";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { usePersistedState } from "../hooks/usePersistedState";
import { useRepoScopedHref } from "../hooks/useRepoScopedHref";
import { useScrollRestoration } from "../hooks/useScrollRestoration";
import { selectionPath } from "../selection-routing";
import {
  buildCreateTodoListPayload,
  hasInvalidCreateTodoDraftItems,
} from "../todos/create-list-form";
import { reorderTodoItems } from "../todos/reorder-items";
import {
  todoItemSelectionRedirect,
  todoListSelectionRedirect,
} from "../todos/selection";
import {
  autoDirProps,
  rtlAwareMarkdownClassName,
  textDirectionProps,
} from "../text-direction";
import { cn } from "../utils";
import { useChatScope } from "./ChatRailShell";
import { ConfirmDialog } from "./ConfirmDialog";
import { ListSearch } from "./ListSearch";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { PageHeader } from "./PageShell";
import { SimpleTooltip } from "./SimpleTooltip";

type ItemEditorState =
  | { mode: "create" }
  | { mode: "edit"; item: TodoItem }
  | null;

type TodoItemFilter = "all" | "open" | "done" | "mine" | "unassigned";
type TodoListKind = "list" | "goal" | "loop";
type TodoListFilter = TodoListKind;
type ManagedGoalResultClass =
  | "succeeded"
  | "pending"
  | "retryable"
  | "needsFix"
  | "fatal";

interface ManagedGoalItemStatus {
  resultClass: ManagedGoalResultClass;
  label: string;
  badgeClass: string;
  reason: string | null;
  nextAction: string | null;
  attempts: number | null;
  nextRetryAt: string | null;
  issue: number | null;
}

const TODO_ITEM_FILTERS: TodoItemFilter[] = [
  "all",
  "open",
  "done",
  "mine",
  "unassigned",
];

const TODO_ITEM_FILTER_LABELS: Record<TodoItemFilter, string> = {
  all: "All",
  open: "Open",
  done: "Done",
  mine: "Mine",
  unassigned: "Unassigned",
};

const TODO_LIST_FILTERS: TodoListFilter[] = ["list", "goal", "loop"];
const TODO_LIST_FILTER_LABELS: Record<TodoListFilter, string> = {
  list: "Lists",
  goal: "Goals",
  loop: "Loops",
};
const TODO_LIST_FILTER_STORAGE_KEY = "todos:list-filter";
const TODO_ITEM_FILTER_STORAGE_KEY = "todos:item-filter";

interface TodoControlProps {
  /** Render without built-in PageHeader (e.g. when hosted in tabs). */
  embedded?: boolean;
  selectedSlug?: string | null;
  selectedItemId?: string | null;
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

function todoListKind(list: TodoEntry): TodoListKind {
  const model = list.frontmatter?.managedModel;
  if (model === "agentGoal") return "goal";
  if (model === "agentLoop") return "loop";
  return "list";
}

function todoListKindLabel(kind: TodoListKind): string {
  if (kind === "goal") return "Goal";
  if (kind === "loop") return "Loop";
  return "List";
}

function todoListKindClass(kind: TodoListKind): string {
  if (kind === "goal") return "border-sky-400/25 bg-sky-400/10 text-sky-200";
  if (kind === "loop")
    return "border-violet-400/25 bg-violet-400/10 text-violet-200";
  return "border-emerald-400/25 bg-emerald-400/10 text-emerald-200";
}

function stringMeta(meta: Record<string, unknown> | undefined, key: string) {
  const value = meta?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberMeta(meta: Record<string, unknown> | undefined, key: string) {
  const value = meta?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function managedGoalResultClass(
  value: string | null,
): ManagedGoalResultClass | null {
  if (
    value === "succeeded" ||
    value === "pending" ||
    value === "retryable" ||
    value === "needsFix" ||
    value === "fatal"
  ) {
    return value;
  }
  return null;
}

function managedGoalStatusTone(resultClass: ManagedGoalResultClass): {
  label: string;
  badgeClass: string;
} {
  if (resultClass === "succeeded") {
    return {
      label: "Done",
      badgeClass: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
    };
  }
  if (resultClass === "pending") {
    return {
      label: "Pending",
      badgeClass: "border-sky-400/30 bg-sky-500/10 text-sky-200",
    };
  }
  if (resultClass === "retryable") {
    return {
      label: "Retrying",
      badgeClass: "border-amber-400/30 bg-amber-500/10 text-amber-200",
    };
  }
  if (resultClass === "needsFix") {
    return {
      label: "Needs fix",
      badgeClass: "border-orange-400/35 bg-orange-500/10 text-orange-200",
    };
  }
  return {
    label: "Blocked",
    badgeClass: "border-red-400/35 bg-red-500/10 text-red-200",
  };
}

function managedGoalItemStatus(item: TodoItem): ManagedGoalItemStatus | null {
  const meta = item.meta;
  const resultClass = managedGoalResultClass(stringMeta(meta, "resultClass"));
  if (!resultClass) return null;
  const tone = managedGoalStatusTone(resultClass);
  const attempts = numberMeta(meta, "attempts");
  const issue = numberMeta(meta, "issue");
  return {
    resultClass,
    label: tone.label,
    badgeClass: tone.badgeClass,
    reason: stringMeta(meta, "reason"),
    nextAction: stringMeta(meta, "nextAction"),
    attempts: attempts !== null && attempts >= 0 ? Math.floor(attempts) : null,
    nextRetryAt: stringMeta(meta, "nextRetryAt"),
    issue: issue !== null && issue > 0 ? Math.floor(issue) : null,
  };
}

function formatRetryTime(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Date(time).toLocaleString();
}

function issueHref(connectedRepo: string | null, issue: number | null) {
  if (!connectedRepo || !issue) return null;
  return `https://github.com/${connectedRepo}/issues/${issue}`;
}

function normalizeAssignee(login: string | null | undefined): string | null {
  const normalized = login?.trim().replace(/^@+/, "");
  return normalized ? normalized.slice(0, 120) : null;
}

function shortTodoLabel(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > 42 ? `${trimmed.slice(0, 39)}...` : trimmed;
}

function todoDescriptionPreview(description: string): string {
  const compact = description
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_~|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return "Saved list description";
  return compact.length > 140 ? `${compact.slice(0, 137)}...` : compact;
}

function displayMetaValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function todoStateBadges(
  list: TodoEntry,
): Array<{ label: string; value: string }> {
  const fm = list.frontmatter ?? {};
  if (fm.managedModel !== "agentGoal" && fm.managedModel !== "agentLoop") {
    return [];
  }
  const rows: Array<{ label: string; value: string | null }> = [
    { label: "Version", value: displayMetaValue(fm.version) },
    { label: "State", value: displayMetaValue(fm.state) },
    { label: "Stage", value: displayMetaValue(fm.stage) },
  ];
  return rows.filter((row): row is { label: string; value: string } =>
    Boolean(row.value),
  );
}

function buildAskCodeContext(list: TodoEntry, item: TodoItem): string {
  return [
    "Please help with this todo item.",
    "",
    `Todo list: ${list.title}`,
    `Todo file: ${list.path || `todos/${list.slug}.json`}`,
    "",
    "List description:",
    list.description.trim() || "(none)",
    "",
    `Todo item: ${item.title}`,
    item.assignee
      ? `Assigned to: @${item.assignee}`
      : "Assigned to: Unassigned",
    "",
    "Item note:",
    item.body.trim() || "(none)",
  ].join("\n");
}

function matchesTodoFilter(
  item: TodoItem,
  filter: TodoItemFilter,
  currentUserLogin: string | null,
): boolean {
  if (filter === "open") return !item.completed;
  if (filter === "done") return item.completed;
  if (filter === "mine")
    return !!currentUserLogin && item.assignee === currentUserLogin;
  if (filter === "unassigned") return !item.assignee;
  return true;
}

function isTodoItemCardClickIgnored(
  target: EventTarget | null,
  currentTarget: EventTarget,
): boolean {
  if (
    !(target instanceof HTMLElement) ||
    !(currentTarget instanceof HTMLElement)
  ) {
    return true;
  }
  const interactiveTarget = target.closest(
    "button,a,input,textarea,select,[role='button'],[role='menuitem'],[data-todo-item-control]",
  );
  return !!interactiveTarget && interactiveTarget !== currentTarget;
}

function stopTodoItemActionClick(event: MouseEvent) {
  event.stopPropagation();
}

export function TodoControl({
  embedded = false,
  selectedSlug = null,
  selectedItemId = null,
}: TodoControlProps = {}) {
  return (
    <AuthGuard>
      <TodoControlInner
        embedded={embedded}
        selectedSlug={selectedSlug}
        selectedItemId={selectedItemId}
      />
    </AuthGuard>
  );
}

export function TodoControlInner({
  embedded = false,
  selectedSlug = null,
  selectedItemId = null,
}: TodoControlProps = {}) {
  const router = useRouter();
  const scopedHref = useRepoScopedHref();
  const {
    data: todoLists = [],
    isLoading,
    isFetching,
    refetch,
    error,
  } = useTodoEntries();
  const [showCreate, setShowCreate] = useState(false);
  const [editingList, setEditingList] = useState<TodoEntry | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TodoEntry | null>(null);
  const [search, setSearch] = useState("");
  const [listFilter, setListFilter] = usePersistedState<TodoListFilter>(
    TODO_LIST_FILTER_STORAGE_KEY,
    "list",
  );
  const { githubUser } = useGitHubIdentity();
  const deleteMutation = useDeleteTodo(githubUser?.login);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return todoLists.filter((list) => {
      const kind = todoListKind(list);
      if (kind !== listFilter) return false;
      if (!q) return true;
      return (
        list.title.toLowerCase().includes(q) ||
        list.slug.toLowerCase().includes(q) ||
        list.description.toLowerCase().includes(q) ||
        list.items.some(
          (item) =>
            item.title.toLowerCase().includes(q) ||
            item.body.toLowerCase().includes(q) ||
            (item.assignee?.toLowerCase().includes(q) ?? false),
        )
      );
    });
  }, [todoLists, listFilter, search]);

  const selectedList = useMemo(
    () => todoLists.find((list) => list.slug === selectedSlug) ?? null,
    [todoLists, selectedSlug],
  );
  const detailScrollRef = useScrollRestoration(
    `todos-detail:${selectedSlug ?? "none"}`,
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
  const listFilterCounts = useMemo<Record<TodoListFilter, number>>(
    () => ({
      list: todoLists.filter((list) => todoListKind(list) === "list").length,
      goal: todoLists.filter((list) => todoListKind(list) === "goal").length,
      loop: todoLists.filter((list) => todoListKind(list) === "loop").length,
    }),
    [todoLists],
  );
  const selectedStats = selectedList ? listStats(selectedList) : null;
  const headerTitle = selectedList?.title ?? "Todos";
  const headerTitleDirectionProps = textDirectionProps(headerTitle);
  const headerSubtitle = selectedStats
    ? `${selectedStats.active} open items · ${selectedStats.total} total`
    : `${aggregate.activeItems} open items · ${todoLists.length} lists`;

  useEffect(() => {
    if (isLoading) return;
    const redirect = todoListSelectionRedirect(
      selectedSlug,
      todoLists.map((list) => list.slug),
    );
    if (redirect) router.replace(scopedHref(redirect));
  }, [isLoading, router, scopedHref, selectedSlug, todoLists]);

  useEffect(() => {
    if (isLoading || !selectedSlug || !selectedList) return;
    const listPath = selectionPath("/todos", selectedSlug);
    const redirect = todoItemSelectionRedirect(
      selectedItemId,
      selectedList.items.map((item) => item.id),
      listPath,
    );
    if (redirect) router.replace(scopedHref(redirect));
  }, [
    isLoading,
    router,
    scopedHref,
    selectedItemId,
    selectedList,
    selectedSlug,
  ]);

  const selectList = (slug: string | null, replace = false) => {
    const path = slug ? selectionPath("/todos", slug) : "/todos";
    if (replace) router.replace(scopedHref(path));
    else router.push(scopedHref(path));
  };

  const selectItem = (
    list: TodoEntry,
    item: TodoItem | null,
    replace = false,
  ) => {
    const path = item
      ? selectionPath("/todos", list.slug, item.id)
      : selectionPath("/todos", list.slug);
    if (replace) router.replace(scopedHref(path), { scroll: false });
    else router.push(scopedHref(path), { scroll: false });
  };

  const headerActions = (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => refetch()}
        disabled={isFetching}
        aria-label="Refresh todo lists"
        title="Refresh todo lists"
        className="w-10 px-0"
      >
        <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
      </Button>
      {selectedList ? (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditingList(selectedList)}
            aria-label={`Edit ${selectedList.title}`}
            title="Edit list"
            className="w-10 px-0"
          >
            <Pencil className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPendingDelete(selectedList)}
            aria-label={`Delete ${selectedList.title}`}
            title="Delete list"
            className="w-10 px-0 text-red-400 hover:text-red-300"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </>
      ) : null}
      <Button
        size="sm"
        onClick={() => setShowCreate(true)}
        aria-label="New todo list"
        title="New list"
        className="w-10 px-0"
      >
        <Plus className="w-4 h-4" />
      </Button>
    </>
  );

  return (
    <div className="h-full bg-black/95 text-white/90 flex flex-col overflow-hidden">
      {embedded ? (
        <div className="shrink-0 flex items-center justify-end gap-2 px-4 md:px-6 py-2 border-b border-white/[0.06] bg-black/20">
          <span
            {...headerTitleDirectionProps}
            className="text-xs text-muted-foreground mr-auto min-w-0 truncate text-start"
            title={headerTitle}
          >
            {headerTitle}
          </span>
          {headerActions}
        </div>
      ) : (
        <PageHeader
          title={headerTitle}
          titleContent={
            <h1
              {...headerTitleDirectionProps}
              className="truncate text-heading-md font-semibold text-start md:text-heading-lg"
              title={headerTitle}
            >
              {headerTitle}
            </h1>
          }
          icon={ListTodo}
          iconClassName="text-emerald-400"
          subtitle={headerSubtitle}
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
              <div className="grid grid-cols-3 gap-1 rounded-md border border-white/[0.08] bg-black/30 p-1">
                {TODO_LIST_FILTERS.map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setListFilter(filter)}
                    className={cn(
                      "rounded px-2 py-1 text-xs transition-colors",
                      listFilter === filter
                        ? "bg-emerald-500/15 text-emerald-200"
                        : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
                    )}
                  >
                    {TODO_LIST_FILTER_LABELS[filter]}
                    <span className="ml-1 text-[10px] opacity-60">
                      {listFilterCounts[filter]}
                    </span>
                  </button>
                ))}
              </div>
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
                const kind = todoListKind(list);
                const sidebarTitleDirectionProps = textDirectionProps(
                  list.title,
                );
                const completed =
                  list.items.length > 0 &&
                  list.items.every((item) => item.completed);
                return (
                  <li key={list.slug}>
                    <button
                      type="button"
                      onClick={() => selectList(list.slug)}
                      className={cn(
                        "w-full px-4 py-3 text-start hover:bg-accent/50 transition-colors relative",
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
                          <div
                            {...sidebarTitleDirectionProps}
                            className="text-sm font-medium truncate text-start"
                          >
                            {list.title}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                            <span
                              className={cn(
                                "rounded border px-1.5 py-0.5 text-[10px]",
                                todoListKindClass(kind),
                              )}
                            >
                              {todoListKindLabel(kind)}
                            </span>
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
          ref={detailScrollRef}
          className={cn(
            "flex-1 min-w-0 overflow-y-auto",
            !selectedList && "hidden md:block",
          )}
        >
          {selectedList ? (
            <TodoListDetail
              key={selectedList.slug}
              list={selectedList}
              selectedItemId={selectedItemId}
              onBack={() => selectList(null)}
              onSelectItem={(item, replace) =>
                selectItem(selectedList, item, replace)
              }
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
          selectList(list.slug);
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
            ? `Todo list "${pendingDelete.title}" and its ${pendingDelete.items.length} items will be removed from the state repo todo store.`
            : ""
        }
        variant="destructive"
        confirmLabel="Delete list"
        onConfirm={() => {
          if (!pendingDelete) return;
          const target = pendingDelete;
          deleteMutation.mutate(target.slug, {
            onSuccess: () => {
              if (selectedSlug === target.slug) selectList(null, true);
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
  selectedItemId,
  onBack,
  onSelectItem,
}: {
  list: TodoEntry;
  selectedItemId: string | null;
  onBack: () => void;
  onSelectItem: (item: TodoItem | null, replace?: boolean) => void;
}) {
  const { githubUser, connectedRepo } = useGitHubIdentity();
  const { setComposerInjection, openMobileChat } = useChatScope();
  const { data: collaborators = [], isLoading: isLoadingCollaborators } =
    useCollaborators();
  const updateMutation = useUpdateTodo(list.slug, githubUser?.login);
  const shouldScrollToInitialSelectedItemRef = useRef(Boolean(selectedItemId));
  const selectedItemNodeRef = useRef<HTMLLIElement | null>(null);
  const [itemEditor, setItemEditor] = useState<ItemEditorState>(null);
  const [pendingItemDelete, setPendingItemDelete] = useState<TodoItem | null>(
    null,
  );
  const [itemFilter, setItemFilter] = usePersistedState<TodoItemFilter>(
    TODO_ITEM_FILTER_STORAGE_KEY,
    "all",
  );
  const [isDescriptionExpanded, setDescriptionExpanded] = useState(false);
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(
    () => new Set(),
  );
  const stats = listStats(list);
  const currentUserLogin = normalizeAssignee(githubUser?.login);
  const hasListDescription = list.description.trim().length > 0;
  const descriptionRegionId = `todo-list-description-${list.slug}`;
  const listDescriptionPreview = hasListDescription
    ? todoDescriptionPreview(list.description)
    : "";
  const listKind = todoListKind(list);
  const stateBadges = todoStateBadges(list);
  const progressPercent =
    stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
  const filterCounts = useMemo<Record<TodoItemFilter, number>>(
    () => ({
      all: list.items.length,
      open: list.items.filter((item) => !item.completed).length,
      done: list.items.filter((item) => item.completed).length,
      mine: currentUserLogin
        ? list.items.filter((item) => item.assignee === currentUserLogin).length
        : 0,
      unassigned: list.items.filter((item) => !item.assignee).length,
    }),
    [currentUserLogin, list.items],
  );
  const filteredItems = useMemo(
    () =>
      list.items.filter((item) =>
        matchesTodoFilter(item, itemFilter, currentUserLogin),
      ),
    [currentUserLogin, itemFilter, list.items],
  );
  const sortableItemIds = useMemo(
    () => filteredItems.map((item) => item.id),
    [filteredItems],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const setSelectedItemNode = useCallback((node: HTMLLIElement | null) => {
    selectedItemNodeRef.current = node;
  }, []);

  useEffect(() => {
    setExpandedItemIds((current) => {
      const currentItemIds = new Set(list.items.map((item) => item.id));
      const next = new Set(
        [...current].filter((itemId) => currentItemIds.has(itemId)),
      );
      return next.size === current.size ? current : next;
    });
  }, [list.items]);

  useEffect(() => {
    if (!selectedItemId) return;
    if (!list.items.some((item) => item.id === selectedItemId)) return;
    setExpandedItemIds((current) => {
      if (current.has(selectedItemId)) return current;
      return new Set(current).add(selectedItemId);
    });
  }, [list.items, selectedItemId]);

  useEffect(() => {
    if (!selectedItemId || !shouldScrollToInitialSelectedItemRef.current) {
      return;
    }

    let frame2 = 0;
    const frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        const node = selectedItemNodeRef.current;
        if (!node) return;
        node.scrollIntoView({ block: "center", inline: "nearest" });
        shouldScrollToInitialSelectedItemRef.current = false;
      });
    });

    return () => {
      cancelAnimationFrame(frame1);
      if (frame2) cancelAnimationFrame(frame2);
    };
  }, [filteredItems, selectedItemId]);

  const allItemsExpanded =
    list.items.length > 0 &&
    list.items.every((item) => expandedItemIds.has(item.id));

  const toggleAllItemsExpanded = () => {
    setExpandedItemIds(
      allItemsExpanded ? new Set() : new Set(list.items.map((item) => item.id)),
    );
  };

  const toggleItemExpanded = (item: TodoItem) => {
    setExpandedItemIds((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  };

  const saveItems = (items: TodoItem[]) => {
    updateMutation.mutate({ items });
  };

  const handleTodoDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const nextItems = reorderTodoItems(
      list.items,
      filteredItems,
      activeId,
      overId,
    );
    if (nextItems === list.items) return;
    saveItems(nextItems);
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
    updateMutation.mutate(
      {
        items: list.items.filter((candidate) => candidate.id !== item.id),
      },
      {
        onSuccess: () => {
          if (selectedItemId === item.id) onSelectItem(null, true);
        },
      },
    );
  };

  const assignItem = (item: TodoItem, assignee: string | null) => {
    const normalizedAssignee = normalizeAssignee(assignee);
    saveItems(
      list.items.map((candidate) =>
        candidate.id === item.id
          ? { ...candidate, assignee: normalizedAssignee }
          : candidate,
      ),
    );
  };

  const askKody = (item: TodoItem) => {
    setComposerInjection({
      id: `todo-kody:${list.slug}:${item.id}:${Date.now()}`,
      label: `Ask Kody: ${shortTodoLabel(item.title)}`,
      context: buildAskCodeContext(list, item),
    });
    openMobileChat();
    toast.success("Todo sent to Kody chat");
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
    const newItem: TodoItem = {
      id: makeItemId(),
      title: input.title,
      body: input.body,
      assignee: null,
      completed: false,
      createdAt: now,
      completedAt: null,
    };
    updateMutation.mutate(
      {
        items: [...list.items, newItem],
      },
      {
        onSuccess: () => {
          setExpandedItemIds((current) => new Set(current).add(newItem.id));
          setItemEditor(null);
          onSelectItem(newItem);
        },
      },
    );
  };

  return (
    <article className="min-h-full">
      <div className="border-b border-white/[0.06] bg-gradient-to-b from-emerald-500/[0.06] via-emerald-500/[0.02] to-transparent">
        <div className="max-w-5xl mx-auto px-4 pb-4 pt-4 md:px-8 md:pb-6 md:pt-8 space-y-5">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="md:hidden gap-1 -ml-2 text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            All lists
          </Button>

          <header className="space-y-2">
            <div className="min-w-0 space-y-2">
              {hasListDescription ? (
                <div className="min-w-0 space-y-2">
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="text-xs font-medium text-foreground">
                        Description
                      </div>
                      {!isDescriptionExpanded ? (
                        <p
                          className="truncate text-xs text-muted-foreground"
                          title={listDescriptionPreview}
                        >
                          {listDescriptionPreview}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setDescriptionExpanded((isExpanded) => !isExpanded)
                      }
                      className="h-7 shrink-0 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                      aria-controls={descriptionRegionId}
                      aria-expanded={isDescriptionExpanded}
                      title={
                        isDescriptionExpanded
                          ? "Hide description"
                          : "Show description"
                      }
                    >
                      {isDescriptionExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {isDescriptionExpanded
                          ? "Hide description"
                          : "Show description"}
                      </span>
                    </Button>
                  </div>
                  {isDescriptionExpanded ? (
                    <div id={descriptionRegionId} className="min-w-0 flex-1">
                      <MarkdownPreview
                        {...autoDirProps}
                        content={list.description}
                        variant="compact"
                        className={cn(
                          "max-w-3xl text-start text-sm prose-headings:my-1 prose-headings:text-base prose-p:my-1 prose-ul:my-1 prose-ol:my-1",
                          rtlAwareMarkdownClassName,
                        )}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                <span
                  className={cn(
                    "rounded border px-2 py-0.5 text-[11px]",
                    todoListKindClass(listKind),
                  )}
                >
                  {todoListKindLabel(listKind)}
                </span>
                <span>
                  {stats.done}/{stats.total} items complete
                </span>
                {stateBadges.map((badge) => (
                  <span
                    key={badge.label}
                    className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-black/20 px-1.5 py-0.5 font-mono text-[10px] text-white/50"
                  >
                    <span className="text-white/30">{badge.label}</span>
                    <span>{badge.value}</span>
                  </span>
                ))}
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
            </div>
          </header>

          <section
            className="space-y-2 border-t border-white/[0.06] pt-4"
            aria-label="Todo list filters"
          >
            <div className="h-1.5 overflow-hidden rounded-sm bg-muted">
              <div
                className="h-full rounded-sm bg-emerald-500 transition-[width]"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {TODO_ITEM_FILTERS.map((filter) => {
                  const isActive = itemFilter === filter;
                  const count = filterCounts[filter];
                  return (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setItemFilter(filter)}
                      disabled={filter === "mine" && !currentUserLogin}
                      className={cn(
                        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                        isActive
                          ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-800 dark:text-emerald-100"
                          : "border-border bg-background/40 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                      )}
                    >
                      <span>{TODO_ITEM_FILTER_LABELS[filter]}</span>
                      <span className="font-mono text-[10px] opacity-70">
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={toggleAllItemsExpanded}
                disabled={list.items.length === 0}
                className="h-7 shrink-0 gap-1.5 px-2.5 text-xs"
              >
                {allItemsExpanded ? (
                  <ChevronRight className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
                <span>{allItemsExpanded ? "Collapse all" : "Expand all"}</span>
              </Button>
            </div>
          </section>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 pb-4 pt-4 md:px-8 md:pb-8 md:pt-5 space-y-4">
        {list.items.length === 0 ? (
          <AddTodoPlaceholder
            label="Add first todo"
            hint="Create the first todo in this list."
            onClick={() => setItemEditor({ mode: "create" })}
          />
        ) : filteredItems.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 py-10 text-center space-y-2">
            <p className="text-sm font-medium text-foreground">
              No {TODO_ITEM_FILTER_LABELS[itemFilter].toLowerCase()} items
            </p>
            <p className="text-xs text-muted-foreground">
              Choose another filter to see more items.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleTodoDragEnd}
            >
              <SortableContext
                items={sortableItemIds}
                strategy={verticalListSortingStrategy}
              >
                <ul className="space-y-3">
                  {filteredItems.map((item) => (
                    <TodoItemCard
                      key={item.id}
                      item={item}
                      isSelected={selectedItemId === item.id}
                      isExpanded={expandedItemIds.has(item.id)}
                      onSelect={() => onSelectItem(item)}
                      onToggle={() => toggleItem(item)}
                      onToggleExpanded={() => toggleItemExpanded(item)}
                      onEdit={() => setItemEditor({ mode: "edit", item })}
                      onAssign={(assignee) => assignItem(item, assignee)}
                      onAskKody={() => askKody(item)}
                      onDelete={() => setPendingItemDelete(item)}
                      onInitialSelectedItemNode={
                        selectedItemId === item.id
                          ? setSelectedItemNode
                          : undefined
                      }
                      connectedRepo={connectedRepo}
                      collaborators={collaborators}
                      isLoadingCollaborators={isLoadingCollaborators}
                      disabled={updateMutation.isPending}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
            <AddTodoPlaceholder
              label="Add todo"
              hint="Create a new todo in this list."
              onClick={() => setItemEditor({ mode: "create" })}
            />
          </div>
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

function AddTodoPlaceholder({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-40 w-full flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-muted/20 px-4 py-10 text-center transition-colors hover:border-emerald-400/60 hover:bg-emerald-500/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500 transition-colors group-hover:bg-emerald-500/20 dark:text-emerald-300">
        <Plus className="w-5 h-5" />
      </span>
      <span className="space-y-1">
        <span className="block text-sm font-medium text-foreground">
          {label}
        </span>
        <span className="block max-w-sm text-xs text-muted-foreground">
          {hint}
        </span>
      </span>
    </button>
  );
}

function TodoItemCard({
  item,
  isSelected,
  isExpanded,
  onSelect,
  onToggle,
  onToggleExpanded,
  onEdit,
  onAssign,
  onAskKody,
  onDelete,
  onInitialSelectedItemNode,
  connectedRepo,
  collaborators,
  isLoadingCollaborators,
  disabled,
}: {
  item: TodoItem;
  isSelected: boolean;
  isExpanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onToggleExpanded: () => void;
  onEdit: () => void;
  onAssign: (assignee: string | null) => void;
  onAskKody: () => void;
  onDelete: () => void;
  onInitialSelectedItemNode?: (node: HTMLLIElement | null) => void;
  connectedRepo: string | null;
  collaborators: GitHubCollaborator[];
  isLoadingCollaborators: boolean;
  disabled: boolean;
}) {
  const assignee = normalizeAssignee(item.assignee);
  const itemTitleDirectionProps = textDirectionProps(item.title);
  const managedStatus = managedGoalItemStatus(item);
  const managedIssueHref = issueHref(
    connectedRepo,
    managedStatus?.issue ?? null,
  );
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef: setSortableNodeRef,
    transform: sortableTransform,
    transition: sortableTransition,
  } = useSortable({ id: item.id, disabled });
  const setItemNodeRef = useCallback(
    (node: HTMLLIElement | null) => {
      setSortableNodeRef(node);
      onInitialSelectedItemNode?.(node);
    },
    [onInitialSelectedItemNode, setSortableNodeRef],
  );

  const controlButtons = (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-label={`Reorder ${item.title}`}
        title="Drag to reorder"
        className="mt-0.5 flex h-6 w-6 shrink-0 touch-none cursor-grab items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-label={item.completed ? "Reopen item" : "Complete item"}
        title={item.completed ? "Reopen item" : "Complete item"}
        className={cn(
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors",
          item.completed
            ? "text-emerald-600 hover:text-emerald-700 dark:text-emerald-300 dark:hover:text-emerald-200"
            : "text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-300",
        )}
      >
        {item.completed ? (
          <CheckCircle2 className="w-5 h-5" />
        ) : (
          <Circle className="w-5 h-5" />
        )}
      </button>
      <button
        type="button"
        onClick={onToggleExpanded}
        aria-expanded={isExpanded}
        aria-label={isExpanded ? "Collapse item" : "Expand item"}
        title={isExpanded ? "Collapse item" : "Expand item"}
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
      </button>
    </>
  );

  const renderItemActions = () => (
    <>
      <TodoAssigneeMenu
        assignee={assignee}
        collaborators={collaborators}
        isLoading={isLoadingCollaborators}
        disabled={disabled}
        onAssign={onAssign}
      />
      <SimpleTooltip content="Ask Kody" side="bottom">
        <Button
          variant="outline"
          size="sm"
          onClick={onAskKody}
          className="h-8 w-8 border-emerald-500/40 bg-emerald-500/10 px-0 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-200"
          aria-label={`Ask Kody about ${item.title}`}
        >
          <Sparkles className="w-3.5 h-3.5" />
        </Button>
      </SimpleTooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            data-todo-item-control
            onClick={stopTodoItemActionClick}
            className="w-8 h-8 px-0 text-muted-foreground"
            title="Item actions"
            aria-label={`Actions for ${item.title}`}
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          data-todo-item-control
          onClick={stopTodoItemActionClick}
          className="w-44"
        >
          <DropdownMenuItem onClick={onEdit} className="cursor-pointer gap-2">
            <Pencil className="w-3.5 h-3.5" />
            Edit item
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onDelete}
            disabled={disabled}
            className="cursor-pointer gap-2 text-red-600 dark:text-red-400"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete item
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  const titleBlock = (
    <div className="min-w-0 flex-1">
      <h2
        {...itemTitleDirectionProps}
        className={cn(
          "text-sm font-semibold break-words text-start leading-6",
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
      {managedStatus ? (
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className={cn(
              "inline-flex h-6 shrink-0 items-center gap-1 rounded border px-2 font-medium",
              managedStatus.badgeClass,
            )}
          >
            {managedStatus.resultClass === "retryable" ? (
              <RotateCw className="h-3 w-3" />
            ) : null}
            <span>{managedStatus.label}</span>
          </span>
          {managedStatus.reason ? (
            <span className="min-w-0 max-w-full break-words">
              {managedStatus.reason}
            </span>
          ) : null}
          {managedStatus.nextAction ? (
            <span className="min-w-0 max-w-full break-words">
              Next: {managedStatus.nextAction}
            </span>
          ) : null}
          {managedStatus.attempts !== null ? (
            <span className="shrink-0 font-mono">
              {managedStatus.attempts} attempt
              {managedStatus.attempts === 1 ? "" : "s"}
            </span>
          ) : null}
          {managedStatus.nextRetryAt ? (
            <span className="min-w-0 max-w-full break-words">
              Retry: {formatRetryTime(managedStatus.nextRetryAt)}
            </span>
          ) : null}
          {managedStatus.issue ? (
            managedIssueHref ? (
              <a
                href={managedIssueHref}
                target="_blank"
                rel="noreferrer"
                data-todo-item-control
                className="inline-flex shrink-0 items-center gap-1 text-foreground underline-offset-2 hover:underline"
                onClick={stopTodoItemActionClick}
              >
                Issue #{managedStatus.issue}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="shrink-0">Issue #{managedStatus.issue}</span>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const expandedBody =
    isExpanded && item.body.trim() ? (
      <MarkdownPreview
        {...autoDirProps}
        content={item.body}
        variant="compact"
        className={cn(
          "border-t border-border/70 pt-3 text-start",
          rtlAwareMarkdownClassName,
        )}
      />
    ) : null;

  return (
    <li
      ref={setItemNodeRef}
      style={{
        transform: CSS.Transform.toString(sortableTransform),
        transition: sortableTransition,
      }}
      onClick={(event) => {
        if (isTodoItemCardClickIgnored(event.target, event.currentTarget)) {
          return;
        }
        onSelect();
      }}
      aria-current={isSelected ? "true" : undefined}
      className={cn(
        "cursor-pointer rounded-md border px-3 py-2.5 transition-colors hover:bg-muted/40",
        item.completed
          ? "border-border/60 bg-muted/20"
          : "border-border bg-card/60",
        isSelected &&
          "border-emerald-400/70 bg-emerald-500/[0.08] ring-1 ring-emerald-400/50",
        isDragging &&
          "relative z-10 opacity-80 shadow-lg ring-1 ring-emerald-400/40",
      )}
    >
      <div className="space-y-3 sm:flex sm:items-start sm:gap-3 sm:space-y-0">
        <div className="flex items-center justify-between gap-3 sm:block">
          <div className="flex items-center gap-3 sm:items-start">
            {controlButtons}
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:hidden">
            {renderItemActions()}
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
            {titleBlock}
            <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
              {renderItemActions()}
            </div>
          </div>
          {expandedBody}
        </div>
      </div>
    </li>
  );
}

function TodoAssigneeMenu({
  assignee,
  collaborators,
  isLoading,
  disabled,
  onAssign,
}: {
  assignee: string | null;
  collaborators: GitHubCollaborator[];
  isLoading: boolean;
  disabled: boolean;
  onAssign: (assignee: string | null) => void;
}) {
  const assignedUser = assignee
    ? collaborators.find((user) => user.login === assignee)
    : undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={cn(
            "h-8 px-2 gap-1.5 text-muted-foreground",
            !assignee && "w-8 px-0",
          )}
          title={assignee ? `Assigned to @${assignee}` : "Assign user"}
          aria-label={assignee ? `Assigned to ${assignee}` : "Assign user"}
        >
          {assignee ? (
            <>
              <Avatar className="h-4 w-4">
                <AvatarImage src={assignedUser?.avatar_url} alt={assignee} />
                <AvatarFallback className="text-[8px]">
                  {assignee[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="max-w-24 truncate text-xs">@{assignee}</span>
            </>
          ) : (
            <UserPlus className="w-3.5 h-3.5" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {assignee ? (
          <DropdownMenuItem
            onClick={() => onAssign(null)}
            className="cursor-pointer"
          >
            Unassign @{assignee}
          </DropdownMenuItem>
        ) : null}
        {isLoading ? (
          <DropdownMenuItem disabled className="flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            Loading collaborators...
          </DropdownMenuItem>
        ) : collaborators.length === 0 ? (
          <DropdownMenuItem disabled>No collaborators</DropdownMenuItem>
        ) : (
          collaborators.map((user) => (
            <DropdownMenuItem
              key={user.login}
              onClick={() => onAssign(user.login)}
              disabled={user.login === assignee}
              className="flex items-center gap-2 cursor-pointer"
            >
              <Avatar className="h-5 w-5">
                <AvatarImage src={user.avatar_url} alt={user.login} />
                <AvatarFallback className="text-[8px]">
                  {user.login[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="truncate">@{user.login}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<Array<{ title: string; body: string }>>(
    [],
  );
  const [touchedTitle, setTouchedTitle] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
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
  const hasInvalidItem = hasInvalidCreateTodoDraftItems(items);
  const canSave =
    !!title.trim() &&
    !titleError &&
    !hasInvalidItem &&
    !createMutation.isPending;
  const addDraftItem = () =>
    setItems((current) => [...current, { title: "", body: "" }]);

  const handleSubmit = () => {
    if (!canSave) return;
    createMutation.mutate(
      buildCreateTodoListPayload({ title, description, items }),
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
              dir="auto"
              className="text-start"
            />
            {titleError ? (
              <p className="text-xs text-rose-300">{titleError}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="todo-list-description">Description</Label>
            <MarkdownEditor
              id="todo-list-description"
              value={description}
              onChange={setDescription}
              rows={8}
              placeholder="Add scope, links, notes, or acceptance criteria."
              emptyPreview="No description"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label>Todos</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addDraftItem}
                className="gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Add todo
              </Button>
            </div>

            {items.length === 0 ? (
              <button
                type="button"
                onClick={addDraftItem}
                className="group flex min-h-36 w-full flex-col items-center justify-center gap-3 rounded-md border border-dashed border-white/[0.16] bg-white/[0.02] px-4 py-8 text-center transition-colors hover:border-emerald-400/60 hover:bg-emerald-500/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-300 transition-colors group-hover:bg-emerald-500/20">
                  <Plus className="w-5 h-5" />
                </span>
                <span className="space-y-1">
                  <span className="block text-sm font-medium text-foreground">
                    Add first todo
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Or create the list empty and add todos later.
                  </span>
                </span>
              </button>
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
                          Todo title
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
                          dir="auto"
                          className="text-start"
                        />
                        {!item.title.trim() && item.body.trim() ? (
                          <p className="text-xs text-rose-300">
                            Add a title to keep this item.
                          </p>
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
  const [description, setDescription] = useState(list.description);

  useEffect(() => {
    setTitle(list.title);
    setDescription(list.description);
  }, [list]);

  const titleError = (() => {
    if (!title.trim()) return "Required";
    if (title.trim().length > 160) return "Keep title under 160 characters.";
    return null;
  })();
  const canSave = !titleError && !updateMutation.isPending;

  const handleSubmit = () => {
    if (!canSave) return;
    if (title.trim() === list.title && description === list.description) {
      onSaved();
      return;
    }
    updateMutation.mutate(
      { title: title.trim(), description },
      { onSuccess: () => onSaved() },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : null)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit list</DialogTitle>
          <DialogDescription>
            Rename the list or update its description. Items stay unchanged.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-todo-list-title">List title</Label>
            <Input
              id="edit-todo-list-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
              dir="auto"
              className="text-start"
            />
            {titleError ? (
              <p className="text-xs text-rose-300">{titleError}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-todo-list-description">Description</Label>
            <MarkdownEditor
              id="edit-todo-list-description"
              value={description}
              onChange={setDescription}
              rows={8}
              placeholder="Add scope, links, notes, or acceptance criteria."
              emptyPreview="No description"
            />
          </div>
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
            {state?.mode === "edit" ? "Edit todo" : "Add todo"}
          </DialogTitle>
          <DialogDescription>
            Each todo is a note with its own completed state.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="todo-item-title">Todo title</Label>
            <Input
              id="todo-item-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Write regression note"
              autoFocus
              dir="auto"
              className="text-start"
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
            {isSaving ? "Saving..." : "Save todo"}
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
