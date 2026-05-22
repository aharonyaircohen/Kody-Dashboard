/**
 * @fileType component
 * @domain profile
 * @pattern profile-control-page
 * @ai-summary Company Profile Control — list, view, create, edit, and
 *   delete profile sections. A section is a markdown file at
 *   `.kody/profile/<slug>.md` in the connected repo: the slug is the
 *   section name (e.g. `mission`, `products`) and the body is factual
 *   context about the company. Each section carries a `for:` scope
 *   (Chat | QA | All) that decides which consumer loads it — chat-scoped
 *   sections feed the kody chat system prompt; qa-scoped sections do not.
 *
 *   Mirrors StaffControl's layout/UX (ListSearch + inline ReactMarkdown
 *   view + MarkdownEditor dialogs), minus any schedule UI — profile
 *   sections are not scheduled — plus a per-section scope selector/badge.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Building,
  Calendar,
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
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
  useCreateProfile,
  useDeleteProfile,
  useProfile,
  useUpdateProfile,
} from "../hooks/useProfile";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import type { ProfileScope, ProfileSection } from "../api";
import { ConfirmDialog } from "./ConfirmDialog";
import { ListSearch } from "./ListSearch";
import { MarkdownEditor } from "./MarkdownEditor";
import { PageHeader } from "./PageShell";

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const SCOPE_OPTIONS: { value: ProfileScope; label: string; hint: string }[] = [
  { value: "chat", label: "Chat", hint: "Loaded into the Kody chat prompt" },
  { value: "qa", label: "QA", hint: "Loaded only by the QA consumer" },
  { value: "all", label: "All", hint: "Loaded by every consumer" },
];

function scopeLabel(scope: ProfileScope): string {
  return SCOPE_OPTIONS.find((o) => o.value === scope)?.label ?? scope;
}

const SCOPE_BADGE_CLASS: Record<ProfileScope, string> = {
  chat: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  qa: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  all: "bg-sky-500/15 text-sky-300 border-sky-500/30",
};

function ScopeBadge({ scope }: { scope: ProfileScope }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        SCOPE_BADGE_CLASS[scope],
      )}
    >
      {scopeLabel(scope)}
    </span>
  );
}

interface ProfileControlProps {
  /** Render without the built-in PageHeader (e.g. when hosted in tabs). */
  embedded?: boolean;
}

export function ProfileControl({ embedded = false }: ProfileControlProps = {}) {
  return (
    <AuthGuard>
      <ProfileControlInner embedded={embedded} />
    </AuthGuard>
  );
}

export function ProfileControlInner({
  embedded = false,
}: ProfileControlProps = {}) {
  const {
    data: sections = [],
    isLoading,
    isFetching,
    refetch,
    error,
  } = useProfile();

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingSection, setEditingSection] = useState<ProfileSection | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = useState<ProfileSection | null>(
    null,
  );

  const selectedSection = useMemo(
    () => sections.find((s) => s.slug === selectedSlug) ?? null,
    [sections, selectedSlug],
  );

  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter(
      (s) =>
        s.slug.toLowerCase().includes(q) || s.body.toLowerCase().includes(q),
    );
  }, [sections, search]);

  const existingSlugs = useMemo(
    () => new Set(sections.map((s) => s.slug)),
    [sections],
  );

  useEffect(() => {
    if (!selectedSlug && sections.length > 0) {
      setSelectedSlug(sections[0].slug);
    }
  }, [sections, selectedSlug]);

  const { githubUser } = useGitHubIdentity();
  const deleteMutation = useDeleteProfile(githubUser?.login);

  const headerActions = (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => refetch()}
        disabled={isFetching}
        aria-label="Refresh profile"
      >
        <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
      </Button>
      <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1">
        <Plus className="w-4 h-4" />
        <span className="hidden sm:inline">New section</span>
      </Button>
    </>
  );

  return (
    <div className="h-full bg-black/95 text-white/90 flex flex-col overflow-hidden">
      <div className="flex-1 min-w-0 h-full overflow-hidden flex flex-col">
        {embedded ? (
          <div className="shrink-0 flex items-center justify-end gap-2 px-4 md:px-6 py-2 border-b border-white/[0.06] bg-black/20">
            <span className="text-xs text-muted-foreground mr-auto">
              {sections.length}{" "}
              {sections.length === 1 ? "section" : "sections"}
            </span>
            {headerActions}
          </div>
        ) : (
          <PageHeader
            title="Company Profile"
            icon={Building}
            iconClassName="text-teal-400"
            subtitle={`${sections.length} ${
              sections.length === 1 ? "section" : "sections"
            }`}
            actions={headerActions}
          />
        )}

        {error ? (
          <div className="shrink-0 px-4 py-3 bg-red-500/10 border-b border-red-500/20 text-sm text-red-400">
            Failed to load profile: {(error as Error).message}
          </div>
        ) : null}

        <div className="flex-1 min-h-0 flex">
          {/* Middle: section list */}
          <aside
            className={cn(
              "w-full md:w-80 md:border-r md:border-border overflow-y-auto",
              selectedSection && "hidden md:block",
            )}
          >
            {sections.length > 0 ? (
              <div className="sticky top-0 z-10 bg-background/95 backdrop-blur px-3 md:px-4 py-2 md:py-3 border-b border-border">
                <ListSearch
                  value={search}
                  onChange={setSearch}
                  placeholder="Search profile…"
                  ariaLabel="Search profile"
                  accent="teal"
                />
              </div>
            ) : null}
            {isLoading ? (
              <EmptyState icon={<FileText />} title="Loading profile…" />
            ) : sections.length === 0 ? (
              <EmptyState
                icon={<Building />}
                title="No profile yet"
                hint="Create your first section to describe your company — mission, products, customers, tone."
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<Building />}
                title="No matching sections"
                hint="No section matches your search. Try a different term."
              />
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((section) => {
                  const isActive = selectedSlug === section.slug;
                  return (
                    <li key={section.slug}>
                      <button
                        type="button"
                        onClick={() => setSelectedSlug(section.slug)}
                        className={cn(
                          "w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors relative",
                          isActive && "bg-accent/70",
                        )}
                      >
                        {isActive ? (
                          <span className="absolute inset-y-0 left-0 w-0.5 bg-teal-400" />
                        ) : null}
                        <div className="flex items-center gap-2">
                          <Building
                            className={cn(
                              "w-3.5 h-3.5 shrink-0",
                              isActive
                                ? "text-teal-400"
                                : "text-muted-foreground",
                            )}
                          />
                          <span className="font-mono text-sm truncate flex-1">
                            {section.slug}
                          </span>
                          <ScopeBadge scope={section.for} />
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(section.updatedAt).toLocaleDateString()}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          {/* Right: section detail */}
          <section
            className={cn(
              "flex-1 min-w-0 overflow-y-auto",
              !selectedSection && "hidden md:block",
            )}
          >
            {selectedSection ? (
              <ProfileDetail
                section={selectedSection}
                onBack={() => setSelectedSlug(null)}
                onEdit={() => setEditingSection(selectedSection)}
                onDelete={() => setPendingDelete(selectedSection)}
              />
            ) : (
              <EmptyState
                icon={<Building />}
                title="Select a section"
                hint="Pick a section from the list to see its content and scope."
              />
            )}
          </section>
        </div>

        {/* Create */}
        <CreateProfileDialog
          open={showCreate}
          existingSlugs={existingSlugs}
          onClose={() => setShowCreate(false)}
          onCreated={(section) => {
            setSelectedSlug(section.slug);
            setShowCreate(false);
          }}
        />

        {/* Edit */}
        {editingSection ? (
          <EditProfileDialog
            section={editingSection}
            onClose={() => setEditingSection(null)}
            onSaved={() => setEditingSection(null)}
          />
        ) : null}

        {/* Delete confirm */}
        <ConfirmDialog
          open={!!pendingDelete}
          title="Delete this profile section?"
          description={
            pendingDelete
              ? `Section "${pendingDelete.slug}" will be removed from .kody/profile/ via a commit on the default branch.`
              : ""
          }
          variant="destructive"
          confirmLabel="Delete section"
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

function ProfileDetail({
  section,
  onBack,
  onEdit,
  onDelete,
}: {
  section: ProfileSection;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const hasBody = section.body.trim().length > 0;
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
            All sections
          </Button>
          <header className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl md:text-3xl font-semibold tracking-tight break-words font-mono">
                  {section.slug}
                </h1>
                <ScopeBadge scope={section.for} />
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  updated {new Date(section.updatedAt).toLocaleDateString()}
                </span>
                <span>·</span>
                <a
                  href={section.htmlUrl}
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
                title="Edit section"
                aria-label="Edit section"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onDelete}
                className="w-9 px-0 text-red-400"
                title="Delete section"
                aria-label="Delete section"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </header>

          {hasBody ? (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 md:p-5">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{section.body}</ReactMarkdown>
              </div>
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
                describe this slice of the company.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={onEdit}
              className="gap-1.5 mt-1"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit section
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function ScopeSelect({
  value,
  onChange,
  id,
}: {
  value: ProfileScope;
  onChange: (next: ProfileScope) => void;
  id?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ProfileScope)}>
      <SelectTrigger id={id}>
        <SelectValue placeholder="Scope" />
      </SelectTrigger>
      <SelectContent>
        {SCOPE_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            <span className="flex flex-col">
              <span>{opt.label}</span>
              <span className="text-[11px] text-muted-foreground">
                {opt.hint}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CreateProfileDialog({
  open,
  existingSlugs,
  onClose,
  onCreated,
}: {
  open: boolean;
  existingSlugs: Set<string>;
  onClose: () => void;
  onCreated: (section: ProfileSection) => void;
}) {
  const { githubUser } = useGitHubIdentity();
  const createMutation = useCreateProfile(githubUser?.login);

  const [slug, setSlug] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState<ProfileScope>("chat");
  const [touchedSlug, setTouchedSlug] = useState(false);

  useEffect(() => {
    if (open) {
      setSlug("");
      setBody("");
      setScope("chat");
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
  const canSave = !!slug && !slugError && !bodyError && !createMutation.isPending;

  const handleSubmit = () => {
    if (!canSave) return;
    createMutation.mutate(
      { slug, body, for: scope },
      { onSuccess: (section) => onCreated(section) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New profile section</DialogTitle>
          <DialogDescription>
            Stored at .kody/profile/&lt;slug&gt;.md. The slug is the section
            name Kody sees (e.g. mission, products, customers); the body is
            plain markdown describing it. Scope decides which consumer loads
            it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="profile-slug">Slug (section name)</Label>
              <Input
                id="profile-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                onBlur={() => setTouchedSlug(true)}
                placeholder="mission"
                className="font-mono"
                autoFocus
              />
              {slugError ? (
                <p className="text-xs text-rose-300">{slugError}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-scope">Scope</Label>
              <ScopeSelect id="profile-scope" value={scope} onChange={setScope} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Body</Label>
            <MarkdownEditor value={body} onChange={setBody} rows={14} />
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
            {createMutation.isPending ? "Creating…" : "Create section"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditProfileDialog({
  section,
  onClose,
  onSaved,
}: {
  section: ProfileSection;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { githubUser } = useGitHubIdentity();
  const updateMutation = useUpdateProfile(section.slug, githubUser?.login);

  const [body, setBody] = useState(section.body || "");
  const [scope, setScope] = useState<ProfileScope>(section.for);

  useEffect(() => {
    setBody(section.body || "");
    setScope(section.for);
  }, [section]);

  const bodyError = body.trim().length === 0 ? "Required" : null;

  const handleSubmit = () => {
    if (bodyError || updateMutation.isPending) return;
    const patch: { body?: string; for?: ProfileScope } = {};
    if (body !== section.body) patch.body = body;
    if (scope !== section.for) patch.for = scope;
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
          <DialogTitle>Edit section `{section.slug}`</DialogTitle>
          <DialogDescription>
            Update the section body or scope. Saving commits the file to the
            default branch.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5 max-w-[200px]">
            <Label htmlFor="edit-profile-scope">Scope</Label>
            <ScopeSelect
              id="edit-profile-scope"
              value={scope}
              onChange={setScope}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Body</Label>
            <MarkdownEditor value={body} onChange={setBody} rows={14} />
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
