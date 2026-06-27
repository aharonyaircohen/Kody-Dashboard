/**
 * @fileType component
 * @domain context
 * @pattern context-control-page
 * @ai-summary Context Control — list, view, create, edit, and delete context
 *   entries. An entry is a markdown file at `context/<slug>.md` in the state repo:
 *   the slug is the entry name (e.g. `company-profile`,
 *   `mission`, `products`) and the body is free-form markdown — curated
 *   context you write FOR Kody (company facts, brand, agentIdentity briefs).
 *   Reference docs that already live in the repo (README, DESIGN_SYSTEM.md)
 *   belong in the repo, not here. Each entry carries a `agent:` list of
 *   agent-member slugs that own it, deciding which consumers load it: entries
 *   owned by the built-in `kody` agent feed the kody chat system prompt;
 *   `qa-engineer` entries feed the engine QA preflight. An empty list means
 *   the entry is unassigned (loaded by nobody).
 *
 *   Mirrors AgentsControl's layout/UX (ListSearch + shared MarkdownPreview
 *   view + MarkdownEditor dialogs), minus any schedule UI — entries are not
 *   scheduled — plus a per-entry agent multi-select and badges.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  ChevronDown,
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
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
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@dashboard/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dashboard/ui/select";
import { AuthGuard } from "../auth-guard";
import { selectionPath } from "../selection-routing";
import { cn } from "../utils";
import {
  useCreateContextEntry,
  useDeleteContextEntry,
  useContextEntries,
  useUpdateContextEntry,
} from "../hooks/useContextEntries";
import { useAgents } from "../hooks/useAgents";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { useMediaQuery } from "../hooks/useMediaQuery";
import type { ContextEntry } from "../api";
import { KODY_CHAT_AGENT, QA_AGENT, ALL_AGENT } from "../context/frontmatter";
import { ConfirmDialog } from "./ConfirmDialog";
import { ListSearch } from "./ListSearch";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { PageHeader } from "./PageShell";

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

type StaffOption = { slug: string; label: string; hint: string };

const ALL_AGENT_FILTER = "__all_staff_filter__";
const NO_AGENT_FILTER = "__no_staff_filter__";

/** The all-agent wildcard, offered as the first toggle in the picker. */
const ALL_AGENT_OPTION: StaffOption = {
  slug: ALL_AGENT,
  label: "All agent",
  hint: "Every agent, including ones added later",
};

/** Built-in agents always offered, even with no matching state repo `agents/*.md` file. */
const BUILTIN_AGENT: StaffOption[] = [
  {
    slug: KODY_CHAT_AGENT,
    label: "Kody",
    hint: "Built-in assistant agentIdentity",
  },
  {
    slug: QA_AGENT,
    label: "QA Engineer",
    hint: "Built-in QA reviewer agentIdentity",
  },
];

const BUILTIN_AGENT_BADGE: Record<string, string> = {
  [ALL_AGENT]: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  [KODY_CHAT_AGENT]: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  [QA_AGENT]: "bg-amber-500/15 text-amber-300 border-amber-500/30",
};
const AGENT_BADGE_FALLBACK =
  "bg-slate-500/15 text-slate-300 border-slate-500/30";

/** Short badge label for an agent slug — friendly for built-ins, raw slug otherwise. */
function staffBadgeLabel(slug: string): string {
  if (slug === ALL_AGENT) return "All agent";
  if (slug === KODY_CHAT_AGENT) return "Kody";
  if (slug === QA_AGENT) return "QA";
  return slug;
}

/**
 * The options offered in an agent multi-select: the built-ins (Kody, QA)
 * plus any state repo `agents/*.md` members.
 */
function useAgentsOptions(): StaffOption[] {
  const { data: agent = [] } = useAgents();
  return useMemo(() => {
    const builtinSlugs = new Set(BUILTIN_AGENT.map((s) => s.slug));
    const extra: StaffOption[] = agent
      .filter((s) => !builtinSlugs.has(s.slug))
      .map((s) => ({
        slug: s.slug,
        label: s.title || s.slug,
        hint: "Custom agent",
      }));
    return [...BUILTIN_AGENT, ...extra];
  }, [agent]);
}

/**
 * Render a badge per owning agent. An empty list renders a single
 * muted "Unassigned" badge — the entry is owned by nobody, loaded by no
 * consumer.
 */
function StaffBadges({ agent }: { agent: string[] }) {
  if (agent.length === 0) {
    return (
      <span className="inline-flex items-center rounded border border-white/15 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Unassigned
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {agent.map((slug) => (
        <span
          key={slug}
          className={cn(
            "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            BUILTIN_AGENT_BADGE[slug] ?? AGENT_BADGE_FALLBACK,
          )}
        >
          {staffBadgeLabel(slug)}
        </span>
      ))}
    </span>
  );
}

interface ContextControlProps {
  /** Render without the built-in PageHeader (e.g. when hosted in tabs). */
  embedded?: boolean;
  selectedSlug?: string | null;
}

export function ContextControl({
  embedded = false,
  selectedSlug = null,
}: ContextControlProps = {}) {
  return (
    <AuthGuard>
      <ContextControlInner embedded={embedded} selectedSlug={selectedSlug} />
    </AuthGuard>
  );
}

export function ContextControlInner({
  embedded = false,
  selectedSlug = null,
}: ContextControlProps = {}) {
  const router = useRouter();
  const autoSelectFirst = useMediaQuery("(min-width: 768px)");
  const {
    data: fetchedEntries,
    isLoading,
    isFetching,
    refetch,
    error,
  } = useContextEntries();
  const entries = useMemo(() => fetchedEntries ?? [], [fetchedEntries]);
  const entriesLoaded = fetchedEntries !== undefined;

  const [showCreate, setShowCreate] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ContextEntry | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ContextEntry | null>(null);

  const selectedEntry = useMemo(
    () => entries.find((s) => s.slug === selectedSlug) ?? null,
    [entries, selectedSlug],
  );

  const [search, setSearch] = useState("");
  const [staffFilter, setStaffFilter] = useState(ALL_AGENT_FILTER);
  const staffOptions = useAgentsOptions();
  const staffTitleBySlug = useMemo(
    () => new Map(staffOptions.map((s) => [s.slug, s.label])),
    [staffOptions],
  );
  const staffFilterOptions = useMemo(() => {
    const slugs = new Set<string>();
    for (const option of staffOptions) {
      if (option.slug !== ALL_AGENT) slugs.add(option.slug);
    }
    for (const entry of entries) {
      for (const slug of entry.agent) {
        if (slug !== ALL_AGENT) slugs.add(slug);
      }
    }
    return [...slugs].sort((a, b) =>
      (staffTitleBySlug.get(a) ?? a).localeCompare(
        staffTitleBySlug.get(b) ?? b,
      ),
    );
  }, [entries, staffOptions, staffTitleBySlug]);
  const hasUnassignedEntries = useMemo(
    () => entries.some((entry) => entry.agent.length === 0),
    [entries],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matchesStaffFilter = (entry: ContextEntry) => {
      if (staffFilter === ALL_AGENT_FILTER) return true;
      if (staffFilter === NO_AGENT_FILTER) return entry.agent.length === 0;
      return (
        entry.agent.includes(ALL_AGENT) || entry.agent.includes(staffFilter)
      );
    };
    return entries.filter(
      (entry) =>
        matchesStaffFilter(entry) &&
        (!q ||
          entry.slug.toLowerCase().includes(q) ||
          entry.body.toLowerCase().includes(q) ||
          entry.agent.some((slug) => slug.toLowerCase().includes(q))),
    );
  }, [entries, search, staffFilter]);

  const existingSlugs = useMemo(
    () => new Set(entries.map((s) => s.slug)),
    [entries],
  );

  useEffect(() => {
    if (isLoading || !entriesLoaded) return;
    if (filtered.length === 0) {
      if (selectedSlug) router.replace("/context");
      return;
    }
    if (selectedSlug && !filtered.some((entry) => entry.slug === selectedSlug)) {
      router.replace("/context");
      return;
    }
    if (!selectedSlug && autoSelectFirst) {
      router.replace(selectionPath("/context", filtered[0].slug));
    }
  }, [
    autoSelectFirst,
    entriesLoaded,
    filtered,
    isLoading,
    router,
    selectedSlug,
  ]);

  const selectEntry = (slug: string | null, replace = false) => {
    const path = slug ? selectionPath("/context", slug) : "/context";
    if (replace) router.replace(path);
    else router.push(path);
  };

  const { githubUser } = useGitHubIdentity();
  const deleteMutation = useDeleteContextEntry(githubUser?.login);

  const headerActions = (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => refetch()}
        disabled={isFetching}
        aria-label="Refresh context"
      >
        <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
      </Button>
      <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1">
        <Plus className="w-4 h-4" />
        <span className="hidden sm:inline">New entry</span>
      </Button>
    </>
  );

  return (
    <div className="h-full bg-black/95 text-white/90 flex flex-col overflow-hidden">
      <div className="flex-1 min-w-0 h-full overflow-hidden flex flex-col">
        {embedded ? (
          <div className="shrink-0 flex items-center justify-end gap-2 px-4 md:px-6 py-2 border-b border-white/[0.06] bg-black/20">
            <span className="text-xs text-muted-foreground mr-auto">
              {entries.length} {entries.length === 1 ? "entry" : "entries"}
            </span>
            {headerActions}
          </div>
        ) : (
          <PageHeader
            title="Context"
            icon={FileText}
            iconClassName="text-teal-400"
            subtitle={`${entries.length} ${
              entries.length === 1 ? "entry" : "entries"
            }`}
            actions={headerActions}
          />
        )}

        {error ? (
          <div className="shrink-0 px-4 py-3 bg-red-500/10 border-b border-red-500/20 text-sm text-red-400">
            Failed to load context: {(error as Error).message}
          </div>
        ) : null}

        <div className="flex-1 min-h-0 flex">
          {/* Middle: entry list */}
          <aside
            className={cn(
              "w-full md:w-80 md:border-r md:border-border overflow-y-auto",
              selectedEntry && "hidden md:block",
            )}
          >
            {entries.length > 0 ? (
              <div className="sticky top-0 z-10 space-y-2 bg-background/95 backdrop-blur px-3 md:px-4 py-2 md:py-3 border-b border-border">
                <ListSearch
                  value={search}
                  onChange={setSearch}
                  placeholder="Search context…"
                  ariaLabel="Search context"
                  accent="teal"
                />
                <ContextStaffFilter
                  value={staffFilter}
                  onChange={setStaffFilter}
                  agentSlugs={staffFilterOptions}
                  staffTitleBySlug={staffTitleBySlug}
                  hasUnassignedEntries={hasUnassignedEntries}
                />
              </div>
            ) : null}
            {isLoading ? (
              <EmptyState icon={<FileText />} title="Loading context…" />
            ) : entries.length === 0 ? (
              <EmptyState
                icon={<FileText />}
                title="No context yet"
                hint="Create your first entry — company facts, brand, tone, or an agentIdentity brief you want Kody to know."
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<FileText />}
                title="No matching entries"
                hint="No entry matches your search. Try a different term."
              />
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((entry) => {
                  const isActive = selectedSlug === entry.slug;
                  return (
                    <li key={entry.slug}>
                      <button
                        type="button"
                        onClick={() => selectEntry(entry.slug)}
                        className={cn(
                          "w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors relative",
                          isActive && "bg-accent/70",
                        )}
                      >
                        {isActive ? (
                          <span className="absolute inset-y-0 left-0 w-0.5 bg-teal-400" />
                        ) : null}
                        <div className="flex items-center gap-2">
                          <FileText
                            className={cn(
                              "w-3.5 h-3.5 shrink-0",
                              isActive
                                ? "text-teal-400"
                                : "text-muted-foreground",
                            )}
                          />
                          <span className="font-mono text-sm truncate flex-1">
                            {entry.slug}
                          </span>
                          <StaffBadges agent={entry.agent} />
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(entry.updatedAt).toLocaleDateString()}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          {/* Right: entry detail */}
          <section
            className={cn(
              "flex-1 min-w-0 overflow-y-auto",
              !selectedEntry && "hidden md:block",
            )}
          >
            {selectedEntry ? (
              <EntryDetail
                entry={selectedEntry}
                onBack={() => selectEntry(null)}
                onEdit={() => setEditingEntry(selectedEntry)}
                onDelete={() => setPendingDelete(selectedEntry)}
              />
            ) : (
              <EmptyState
                icon={<FileText />}
                title="Select an entry"
                hint="Pick an entry from the list to see its content and owning agent."
              />
            )}
          </section>
        </div>

        {/* Create */}
        <CreateEntryDialog
          open={showCreate}
          existingSlugs={existingSlugs}
          onClose={() => setShowCreate(false)}
          onCreated={(entry) => {
            selectEntry(entry.slug);
            setShowCreate(false);
          }}
        />

        {/* Edit */}
        {editingEntry ? (
          <EditEntryDialog
            entry={editingEntry}
            onClose={() => setEditingEntry(null)}
            onSaved={() => setEditingEntry(null)}
          />
        ) : null}

        {/* Delete confirm */}
        <ConfirmDialog
          open={!!pendingDelete}
          title="Delete this context entry?"
          description={
            pendingDelete
              ? `Entry "${pendingDelete.slug}" will be removed from the state repo context store.`
              : ""
          }
          variant="destructive"
          confirmLabel="Delete entry"
          onConfirm={() => {
            if (!pendingDelete) return;
            const target = pendingDelete;
            deleteMutation.mutate(target.slug, {
              onSuccess: () => {
                if (selectedSlug === target.slug) selectEntry(null, true);
              },
            });
          }}
          onClose={() => setPendingDelete(null)}
        />
      </div>
    </div>
  );
}

function EntryDetail({
  entry,
  onBack,
  onEdit,
  onDelete,
}: {
  entry: ContextEntry;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const hasBody = entry.body.trim().length > 0;
  return (
    <article className="min-h-full">
      {/* Hero */}
      <div className="border-b border-white/[0.06] bg-gradient-to-b from-teal-500/[0.06] via-teal-500/[0.02] to-transparent">
        <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="md:hidden gap-1 -ml-2 text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            All entries
          </Button>
          <header className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl md:text-3xl font-semibold tracking-tight break-words font-mono">
                  {entry.slug}
                </h1>
                <StaffBadges agent={entry.agent} />
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  updated {new Date(entry.updatedAt).toLocaleDateString()}
                </span>
                <span>·</span>
                <a
                  href={entry.htmlUrl}
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
                <code className="font-mono text-teal-200">
                  {`context/${entry.slug}.md`}
                </code>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={onEdit}
                className="w-9 px-0"
                title="Edit entry"
                aria-label="Edit entry"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onDelete}
                className="w-9 px-0 text-red-400"
                title="Delete entry"
                aria-label="Delete entry"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </header>

          {hasBody ? (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 md:p-5">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-white/45">
                Current saved content
              </p>
              <MarkdownPreview content={entry.body} variant="compact" />
            </div>
          ) : null}
        </div>
      </div>

      {/* Empty body fallback below the hero */}
      {!hasBody ? (
        <div className="max-w-4xl mx-auto p-4 md:p-8">
          <div className="rounded-xl border border-dashed border-white/[0.1] bg-white/[0.02] py-12 text-center space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full bg-teal-500/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-teal-400" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                No content yet
              </p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Use <span className="font-medium text-foreground">Edit</span> to
                write this entry.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={onEdit}
              className="gap-1.5 mt-1"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit entry
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function ContextStaffFilter({
  value,
  onChange,
  agentSlugs,
  staffTitleBySlug,
  hasUnassignedEntries,
}: {
  value: string;
  onChange: (next: string) => void;
  agentSlugs: string[];
  staffTitleBySlug: Map<string, string>;
  hasUnassignedEntries: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label="Filter context by agent"
        className="h-9 w-full min-w-0 bg-background/40"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_AGENT_FILTER}>All agent</SelectItem>
        {hasUnassignedEntries ? (
          <SelectItem value={NO_AGENT_FILTER}>Unassigned</SelectItem>
        ) : null}
        {agentSlugs.map((slug) => {
          const title = staffTitleBySlug.get(slug);
          return (
            <SelectItem key={slug} value={slug}>
              {title ? `${title} (${slug})` : slug}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

/** One-line summary of the current selection, shown on the dropdown trigger. */
function staffSummary(value: string[], options: StaffOption[]): string {
  if (value.includes(ALL_AGENT)) return "All agent";
  if (value.length === 0) return "Unassigned";
  if (value.length === 1) {
    return options.find((o) => o.slug === value[0])?.label ?? value[0];
  }
  return `${value.length} agents`;
}

/**
 * Attach an entry to agents via a compact dropdown. The relation is
 * the only thing stored: each selected agent owns the entry. Three
 * shapes:
 *   - one or more specific agents,
 *   - "All agent" (the `*` wildcard) — mutually exclusive with specifics, and
 *   - none selected → "Unassigned" (owned by nobody).
 * Any already-attached slug that isn't a known option is still listed so it
 * can be unchecked. The menu stays open across toggles (onSelect preventDefault).
 */
function StaffSelect({
  value,
  options,
  onChange,
}: {
  value: string[];
  options: StaffOption[];
  onChange: (next: string[]) => void;
}) {
  const allActive = value.includes(ALL_AGENT);

  const shown: StaffOption[] = [...options];
  for (const slug of value) {
    if (slug !== ALL_AGENT && !options.some((o) => o.slug === slug)) {
      shown.push({ slug, label: slug, hint: "Not a known agent" });
    }
  }
  const order = shown.map((o) => o.slug);

  const setAll = (checked: boolean) => onChange(checked ? [ALL_AGENT] : []);

  const toggleSpecific = (slug: string, checked: boolean) => {
    const base = value.filter((v) => v !== ALL_AGENT); // picking a specific drops the wildcard
    if (checked) {
      const merged = new Set([...base, slug]);
      onChange(order.filter((s) => merged.has(s)));
    } else {
      onChange(base.filter((v) => v !== slug));
    }
  };

  return (
    <div className="space-y-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-between font-normal"
          >
            <span className="truncate">{staffSummary(value, options)}</span>
            <ChevronDown className="w-4 h-4 opacity-60 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56"
        >
          <DropdownMenuCheckboxItem
            checked={allActive}
            onCheckedChange={setAll}
            onSelect={(e) => e.preventDefault()}
          >
            {ALL_AGENT_OPTION.label}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {shown.map((opt) => (
            <DropdownMenuCheckboxItem
              key={opt.slug}
              checked={!allActive && value.includes(opt.slug)}
              onCheckedChange={(c) => toggleSpecific(opt.slug, c)}
              onSelect={(e) => e.preventDefault()}
            >
              <span className="font-mono">{opt.label}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <p className="text-[11px] text-muted-foreground px-0.5">
        {allActive
          ? "All agent — every agent is attached to this entry."
          : value.length === 0
            ? "Unassigned — not attached to any agent."
            : "Attached to each selected agent."}
      </p>
    </div>
  );
}

function CreateEntryDialog({
  open,
  existingSlugs,
  onClose,
  onCreated,
}: {
  open: boolean;
  existingSlugs: Set<string>;
  onClose: () => void;
  onCreated: (entry: ContextEntry) => void;
}) {
  const { githubUser } = useGitHubIdentity();
  const createMutation = useCreateContextEntry(githubUser?.login);
  const staffOptions = useAgentsOptions();

  const [slug, setSlug] = useState("");
  const [body, setBody] = useState("");
  const [agent, setStaff] = useState<string[]>([KODY_CHAT_AGENT]);
  const [touchedSlug, setTouchedSlug] = useState(false);

  useEffect(() => {
    if (open) {
      setSlug("");
      setBody("");
      setStaff([KODY_CHAT_AGENT]);
      setTouchedSlug(false);
    }
  }, [open]);

  const slugError = (() => {
    if (!touchedSlug) return null;
    if (!slug) return "Required";
    if (!SLUG_RE.test(slug))
      return "Use lowercase letters, digits, dashes, underscores. Start with a letter or digit.";
    if (existingSlugs.has(slug)) return `"${slug}" already exists`;
    return null;
  })();

  const bodyError = body.trim().length === 0 ? "Required" : null;
  const canSave =
    !!slug && !slugError && !bodyError && !createMutation.isPending;

  const handleSubmit = () => {
    if (!canSave) return;
    createMutation.mutate(
      { slug, body, agent },
      { onSuccess: (entry) => onCreated(entry) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New context entry</DialogTitle>
          <DialogDescription>
            Stored at context/&lt;slug&gt;.md in the state repo. The slug is the entry name
            Kody sees (e.g. company-profile, mission, products); the body is
            plain markdown. Agent decides which consumers load it — leave all
            unchecked to keep the entry unassigned.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="entry-slug">Slug (entry name)</Label>
            <Input
              id="entry-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              onBlur={() => setTouchedSlug(true)}
              placeholder="company-profile"
              className="font-mono"
              autoFocus
            />
            {slugError ? (
              <p className="text-xs text-rose-300">{slugError}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label>Agent</Label>
            <StaffSelect
              value={agent}
              options={staffOptions}
              onChange={setStaff}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Body</Label>
            <MarkdownEditor value={body} onChange={setBody} rows={10} />
            {bodyError ? (
              <p className="text-xs text-rose-300">{bodyError}</p>
            ) : null}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!canSave}>
            {createMutation.isPending ? "Creating…" : "Create entry"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditEntryDialog({
  entry,
  onClose,
  onSaved,
}: {
  entry: ContextEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { githubUser } = useGitHubIdentity();
  const updateMutation = useUpdateContextEntry(entry.slug, githubUser?.login);
  const staffOptions = useAgentsOptions();

  const [body, setBody] = useState(entry.body || "");
  const [agent, setStaff] = useState<string[]>(entry.agent);

  useEffect(() => {
    setBody(entry.body || "");
    setStaff(entry.agent);
  }, [entry]);

  const bodyError = body.trim().length === 0 ? "Required" : null;

  const staffChanged =
    agent.length !== entry.agent.length ||
    agent.some((s) => !entry.agent.includes(s));

  const handleSubmit = () => {
    if (bodyError || updateMutation.isPending) return;
    const patch: { body?: string; agent?: string[] } = {};
    if (body !== entry.body) patch.body = body;
    if (staffChanged) patch.agent = agent;
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
          <DialogTitle>Edit entry `{entry.slug}`</DialogTitle>
          <DialogDescription>
            Update the entry body or owning agent. Saving commits the file to
            the default branch.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="rounded-md border border-white/[0.08] bg-white/[0.03] p-3">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-white/70">Active file</span>
              <code className="font-mono text-teal-200">
                {`context/${entry.slug}.md`}
              </code>
            </div>
            <div className="mt-3 space-y-1.5">
              <p className="text-xs font-medium text-white/70">
                Current saved content
              </p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-white/[0.06] bg-black/30 p-3 font-mono text-xs leading-relaxed text-white/65">
                {entry.body}
              </pre>
            </div>
          </div>
          <div className="space-y-1.5 max-w-[280px]">
            <Label>Agent</Label>
            <StaffSelect
              value={agent}
              options={staffOptions}
              onChange={setStaff}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Body</Label>
            <MarkdownEditor value={body} onChange={setBody} rows={10} />
            {bodyError ? (
              <p className="text-xs text-rose-300">{bodyError}</p>
            ) : null}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!!bodyError || updateMutation.isPending}
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
