/**
 * @fileType component
 * @domain profile
 * @pattern profile-control-page
 * @ai-summary Company Profile Control — list, view, create, edit, and
 *   delete profile sections. A section is a markdown file at
 *   `.kody/profile/<slug>.md` in the connected repo: the slug is the
 *   section name (e.g. `mission`, `products`) and the body is factual
 *   context about the company. Each section carries a `staff:` list of
 *   staff-member slugs that own it, deciding which consumers load it:
 *   sections owned by the built-in `kody` staff feed the kody chat system
 *   prompt; `qa-engineer` sections feed the engine QA preflight. An empty
 *   list means the doc is unassigned (loaded by nobody).
 *
 *   Mirrors StaffControl's layout/UX (ListSearch + inline ReactMarkdown
 *   view + MarkdownEditor dialogs), minus any schedule UI — profile
 *   sections are not scheduled — plus a per-section staff multi-select
 *   and badges.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Building,
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
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@dashboard/ui/dropdown-menu";
import { AuthGuard } from "../auth-guard";
import { cn } from "../utils";
import {
  useCreateProfile,
  useDeleteProfile,
  useProfile,
  useUpdateProfile,
} from "../hooks/useProfile";
import { useStaff } from "../hooks/useStaff";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import type { ProfileSection } from "../api";
import { KODY_CHAT_STAFF, QA_STAFF, ALL_STAFF } from "../profile/frontmatter";
import { ConfirmDialog } from "./ConfirmDialog";
import { ListSearch } from "./ListSearch";
import { MarkdownEditor } from "./MarkdownEditor";
import { PageHeader } from "./PageShell";

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

type StaffOption = { slug: string; label: string; hint: string };

/** The all-staff wildcard, offered as the first toggle in the picker. */
const ALL_STAFF_OPTION: StaffOption = {
  slug: ALL_STAFF,
  label: "All staff",
  hint: "Every staff member, including ones added later",
};

/** Built-in staff members always offered, even with no matching `.kody/staff/*.md` file. */
const BUILTIN_STAFF: StaffOption[] = [
  {
    slug: KODY_CHAT_STAFF,
    label: "Kody",
    hint: "Built-in assistant persona",
  },
  {
    slug: QA_STAFF,
    label: "QA Engineer",
    hint: "Built-in QA reviewer persona",
  },
];

const BUILTIN_STAFF_BADGE: Record<string, string> = {
  [ALL_STAFF]: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  [KODY_CHAT_STAFF]: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  [QA_STAFF]: "bg-amber-500/15 text-amber-300 border-amber-500/30",
};
const STAFF_BADGE_FALLBACK =
  "bg-slate-500/15 text-slate-300 border-slate-500/30";

/** Short badge label for a staff slug — friendly for built-ins, raw slug otherwise. */
function staffBadgeLabel(slug: string): string {
  if (slug === ALL_STAFF) return "All staff";
  if (slug === KODY_CHAT_STAFF) return "Kody";
  if (slug === QA_STAFF) return "QA";
  return slug;
}

/**
 * The options offered in a staff multi-select: the built-ins (Kody, QA)
 * plus any `.kody/staff/*.md` members in the connected repo.
 */
function useStaffOptions(): StaffOption[] {
  const { data: staff = [] } = useStaff();
  return useMemo(() => {
    const builtinSlugs = new Set(BUILTIN_STAFF.map((s) => s.slug));
    const extra: StaffOption[] = staff
      .filter((s) => !builtinSlugs.has(s.slug))
      .map((s) => ({
        slug: s.slug,
        label: s.title || s.slug,
        hint: "Custom staff member",
      }));
    return [...BUILTIN_STAFF, ...extra];
  }, [staff]);
}

/**
 * Render a badge per owning staff member. An empty list renders a single
 * muted "Unassigned" badge — the doc is owned by nobody, loaded by no
 * consumer.
 */
function StaffBadges({ staff }: { staff: string[] }) {
  if (staff.length === 0) {
    return (
      <span className="inline-flex items-center rounded border border-white/15 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Unassigned
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {staff.map((slug) => (
        <span
          key={slug}
          className={cn(
            "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            BUILTIN_STAFF_BADGE[slug] ?? STAFF_BADGE_FALLBACK,
          )}
        >
          {staffBadgeLabel(slug)}
        </span>
      ))}
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
                          <StaffBadges staff={section.staff} />
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
                hint="Pick a section from the list to see its content and owning staff."
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
                <StaffBadges staff={section.staff} />
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

/** One-line summary of the current selection, shown on the dropdown trigger. */
function staffSummary(value: string[], options: StaffOption[]): string {
  if (value.includes(ALL_STAFF)) return "All staff";
  if (value.length === 0) return "Unassigned";
  if (value.length === 1) {
    return options.find((o) => o.slug === value[0])?.label ?? value[0];
  }
  return `${value.length} staff members`;
}

/**
 * Attach a doc to staff members via a compact dropdown. The relation is the
 * only thing stored: each selected staff member owns the doc. Three shapes:
 *   - one or more specific staff members,
 *   - "All staff" (the `*` wildcard) — mutually exclusive with specifics, and
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
  const allActive = value.includes(ALL_STAFF);

  const shown: StaffOption[] = [...options];
  for (const slug of value) {
    if (slug !== ALL_STAFF && !options.some((o) => o.slug === slug)) {
      shown.push({ slug, label: slug, hint: "Not a known staff member" });
    }
  }
  const order = shown.map((o) => o.slug);

  const setAll = (checked: boolean) => onChange(checked ? [ALL_STAFF] : []);

  const toggleSpecific = (slug: string, checked: boolean) => {
    const base = value.filter((v) => v !== ALL_STAFF); // picking a specific drops the wildcard
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
            {ALL_STAFF_OPTION.label}
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
          ? "All staff — every staff member is attached to this doc."
          : value.length === 0
            ? "Unassigned — not attached to any staff member."
            : "Attached to each selected staff member."}
      </p>
    </div>
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
  const staffOptions = useStaffOptions();

  const [slug, setSlug] = useState("");
  const [body, setBody] = useState("");
  const [staff, setStaff] = useState<string[]>([KODY_CHAT_STAFF]);
  const [touchedSlug, setTouchedSlug] = useState(false);

  useEffect(() => {
    if (open) {
      setSlug("");
      setBody("");
      setStaff([KODY_CHAT_STAFF]);
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
      { slug, body, staff },
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
            plain markdown describing it. Staff decides which consumers load
            it — leave all unchecked to keep the doc unassigned.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
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
            <Label>Staff</Label>
            <StaffSelect
              value={staff}
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
  const staffOptions = useStaffOptions();

  const [body, setBody] = useState(section.body || "");
  const [staff, setStaff] = useState<string[]>(section.staff);

  useEffect(() => {
    setBody(section.body || "");
    setStaff(section.staff);
  }, [section]);

  const bodyError = body.trim().length === 0 ? "Required" : null;

  const staffChanged =
    staff.length !== section.staff.length ||
    staff.some((s) => !section.staff.includes(s));

  const handleSubmit = () => {
    if (bodyError || updateMutation.isPending) return;
    const patch: { body?: string; staff?: string[] } = {};
    if (body !== section.body) patch.body = body;
    if (staffChanged) patch.staff = staff;
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
            Update the section body or owning staff. Saving commits the file
            to the default branch.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5 max-w-[280px]">
            <Label>Staff</Label>
            <StaffSelect
              value={staff}
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
