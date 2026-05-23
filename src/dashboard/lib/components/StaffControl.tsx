/**
 * @fileType component
 * @domain kody
 * @pattern staff-control-page
 * @ai-summary Staff Control — list, view, create, edit, and delete staff.
 *   A staff member is a pure reusable PERSONA file at `.kody/staff/<slug>.md`
 *   in the connected repo: a markdown body describing the staff member's
 *   intent, allowed commands, and restrictions. Staff have no schedule, no
 *   state, and no run/tick — they're personas referenced by other flows.
 *   The chat rail reuses the existing duty/duty-draft scope kinds (a staff
 *   member is structurally identical to a duty).
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
  useCreateStaff,
  useDeleteStaff,
  useStaff,
  useUpdateStaff,
} from "../hooks/useStaff";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import type { Staff } from "../api";
import { KODY_CHAT_STAFF } from "../profile/frontmatter";
import { STAFF_TEMPLATE } from "../staff-template";
import { ConfirmDialog } from "./ConfirmDialog";
import { ListSearch } from "./ListSearch";
import { MarkdownEditor } from "./MarkdownEditor";
import { PageHeader } from "./PageShell";
import { useChatScope } from "./ChatRailShell";

function newDraftId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Kody — the built-in chat persona. Always present in the staff list and
 * never editable or removable (it lives in code, not a `.kody/staff/*.md`
 * file). Identified by the `kody` slug; `isBuiltinStaff` gates the UI.
 */
const BUILTIN_KODY_STAFF: Staff = {
  slug: KODY_CHAT_STAFF,
  title: "Kody",
  body:
    "Kody is the built-in assistant persona — the staff member the in-process " +
    "chat runs as. It is always available and can't be edited or removed here. " +
    "Attach Company Profile docs to Kody to inject them into every chat turn.",
  updatedAt: "",
  htmlUrl: "",
};

/** True for built-in const staff (no file, no edit/delete). */
function isBuiltinStaff(slug: string): boolean {
  return slug === KODY_CHAT_STAFF;
}

interface StaffControlProps {
  /** Render without the built-in PageHeader (e.g. when hosted in StaffPageTabs). */
  embedded?: boolean;
}

export function StaffControl({ embedded = false }: StaffControlProps = {}) {
  return (
    <AuthGuard>
      <StaffControlInner embedded={embedded} />
    </AuthGuard>
  );
}

export function StaffControlInner({
  embedded = false,
}: StaffControlProps = {}) {
  const {
    data: rawStaff = [],
    isLoading,
    isFetching,
    refetch,
    error,
  } = useStaff();

  // Kody is always first and never removable; repo staff follow (any stray
  // `kody.md` file is dropped so the const wins).
  const staff = useMemo(
    () => [
      BUILTIN_KODY_STAFF,
      ...rawStaff.filter((m) => !isBuiltinStaff(m.slug)),
    ],
    [rawStaff],
  );

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingMember, setEditingMember] = useState<Staff | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Staff | null>(null);

  // Chat-panel state. The left rail switches between three modes:
  //  • staff mode    — when a staff member is selected and we're not drafting
  //  • draft mode     — when "Draft new staff member" is active (rotates draftId)
  //  • disabled       — neither (e.g. no staff yet)
  // `draftPrefill` carries an assistant reply the user picked via
  // "Use as staff" into CreateStaffDialog.
  const [isDrafting, setIsDrafting] = useState(false);
  const [draftId, setDraftId] = useState<string>(() => newDraftId());
  const [draftPrefill, setDraftPrefill] = useState<string | null>(null);
  const startNewDraft = () => {
    setIsDrafting(true);
    setDraftId(newDraftId());
  };
  const cancelDraft = () => setIsDrafting(false);

  const selectedMember = useMemo(
    () => staff.find((m) => m.slug === selectedSlug) ?? null,
    [staff, selectedSlug],
  );

  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter(
      (m) =>
        m.slug.toLowerCase().includes(q) ||
        m.title.toLowerCase().includes(q) ||
        m.body.toLowerCase().includes(q),
    );
  }, [staff, search]);

  useEffect(() => {
    if (!selectedSlug && staff.length > 0) {
      setSelectedSlug(staff[0].slug);
    }
  }, [staff, selectedSlug]);

  const { githubUser } = useGitHubIdentity();
  const deleteMutation = useDeleteStaff(githubUser?.login);

  // Push chat context up to the persistent rail in the root layout.
  // A staff member is structurally identical to a duty, so we reuse the
  // existing duty / duty-draft scope kinds — the chat just needs the file's
  // title/body to answer questions or draft a new one.
  const { setScope } = useChatScope();
  useEffect(() => {
    setScope(
      isDrafting
        ? {
            kind: "duty-draft",
            draftId,
            onFinalize: (assistantContent) => {
              setDraftPrefill(assistantContent);
              setShowCreate(true);
            },
          }
        : selectedMember
          ? { kind: "duty", duty: selectedMember }
          : null,
    );
    return () => setScope(null);
  }, [isDrafting, draftId, selectedMember, setScope]);

  return (
    <div className="h-full bg-black/95 text-white/90 flex flex-col overflow-hidden">
      {/* Chat rail + sidebar come from the root layout (ChatRailShell). */}
      <div className="flex-1 min-w-0 h-full overflow-hidden flex flex-col">
        {embedded ? (
          <div className="shrink-0 flex items-center justify-end gap-2 px-4 md:px-6 py-2 border-b border-white/[0.06] bg-black/20">
            <span className="text-xs text-muted-foreground mr-auto">
              {staff.length} {staff.length === 1 ? "member" : "staff"}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label="Refresh staff"
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
                title="Stop drafting; chat returns to the selected staff member"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Back to staff</span>
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={startNewDraft}
                className="gap-1"
                title="Chat with Kody to scope a brand-new staff member"
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
              <span className="hidden sm:inline">New member</span>
            </Button>
          </div>
        ) : (
          <PageHeader
            title="Staff Control"
            icon={Target}
            iconClassName="text-emerald-400"
            subtitle={`${staff.length} ${staff.length === 1 ? "member" : "staff"}`}
            actions={
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetch()}
                  disabled={isFetching}
                  aria-label="Refresh staff"
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
                    title="Stop drafting; chat returns to the selected staff member"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span className="hidden sm:inline">Back to staff</span>
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={startNewDraft}
                    className="gap-1"
                    title="Chat with Kody to scope a brand-new staff member"
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
                  <span className="hidden sm:inline">New member</span>
                </Button>
              </>
            }
          />
        )}

        {error ? (
          <div className="shrink-0 px-4 py-3 bg-red-500/10 border-b border-red-500/20 text-sm text-red-400">
            Failed to load staff: {(error as Error).message}
          </div>
        ) : null}

        <div className="flex-1 min-h-0 flex">
          {/* Middle: staff list */}
          <aside
            className={cn(
              "w-full md:w-80 md:border-r md:border-border overflow-y-auto",
              selectedMember && "hidden md:block",
            )}
          >
            {staff.length > 0 ? (
              <div className="sticky top-0 z-10 bg-background/95 backdrop-blur px-3 md:px-4 py-2 md:py-3 border-b border-border">
                <ListSearch
                  value={search}
                  onChange={setSearch}
                  placeholder="Search staff…"
                  ariaLabel="Search staff"
                  accent="emerald"
                />
              </div>
            ) : null}
            {isLoading ? (
              <EmptyState icon={<FileText />} title="Loading staff…" />
            ) : staff.length === 0 ? (
              <EmptyState
                icon={<Target />}
                title="No staff yet"
                hint="Create your first staff member to describe the intent, system prompt, and restrictions."
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<Target />}
                title="No matching staff"
                hint="No staff member matches your search. Try a different term."
              />
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((member) => {
                  const isActive = selectedSlug === member.slug;
                  return (
                    <li key={member.slug}>
                      <button
                        type="button"
                        onClick={() => setSelectedSlug(member.slug)}
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
                            {member.title}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                          <span className="font-mono opacity-80">
                            {member.slug}
                          </span>
                          <span>·</span>
                          {isBuiltinStaff(member.slug) ? (
                            <span>Built-in</span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {new Date(member.updatedAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          {/* Right: staff detail */}
          <section
            className={cn(
              "flex-1 min-w-0 overflow-y-auto",
              !selectedMember && "hidden md:block",
            )}
          >
            {selectedMember ? (
              <StaffDetail
                member={selectedMember}
                onBack={() => setSelectedSlug(null)}
                onEdit={() => setEditingMember(selectedMember)}
                onDelete={() => setPendingDelete(selectedMember)}
              />
            ) : (
              <EmptyState
                icon={<Target />}
                title="Select a staff member"
                hint="Pick a staff member from the list to see its intent and system prompt."
              />
            )}
          </section>
        </div>

        {/* Create */}
        <CreateStaffDialog
          open={showCreate}
          initialBody={draftPrefill}
          onClose={() => {
            setShowCreate(false);
            setDraftPrefill(null);
          }}
          onCreated={(member) => {
            setSelectedSlug(member.slug);
            setShowCreate(false);
            setDraftPrefill(null);
            // Drop out of draft mode so the chat is now scoped to the
            // newly-created staff member instead of the old draft session.
            setIsDrafting(false);
          }}
        />

        {/* Edit */}
        {editingMember ? (
          <EditStaffDialog
            member={editingMember}
            onClose={() => setEditingMember(null)}
            onSaved={() => setEditingMember(null)}
          />
        ) : null}

        {/* Delete confirm */}
        <ConfirmDialog
          open={!!pendingDelete}
          title="Delete this staff member?"
          description={
            pendingDelete
              ? `Staff member "${pendingDelete.title}" (${pendingDelete.slug}) will be removed from .kody/staff/ via a commit on the default branch.`
              : ""
          }
          variant="destructive"
          confirmLabel="Delete member"
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

function StaffDetail({
  member,
  onBack,
  onEdit,
  onDelete,
}: {
  member: Staff;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const hasBody = member.body.trim().length > 0;
  const isBuiltin = isBuiltinStaff(member.slug);
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
            All staff
          </Button>
          <header className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1 space-y-2">
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight break-words">
                {member.title}
              </h1>
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                <span className="font-mono opacity-80">{member.slug}</span>
                {isBuiltin ? (
                  <>
                    <span>·</span>
                    <span>Built-in persona</span>
                  </>
                ) : (
                  <>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      updated {new Date(member.updatedAt).toLocaleDateString()}
                    </span>
                    <span>·</span>
                    <a
                      href={member.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                      title="Open on GitHub"
                    >
                      <ExternalLink className="w-3 h-3" />
                      GitHub
                    </a>
                  </>
                )}
              </div>
            </div>
            {isBuiltin ? (
              <span className="shrink-0 inline-flex items-center rounded border border-teal-500/30 bg-teal-500/10 px-2 py-1 text-[11px] font-medium text-teal-300">
                Built-in · permanent
              </span>
            ) : (
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onEdit}
                  className="w-9 px-0"
                  title="Edit staff member"
                  aria-label="Edit staff member"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onDelete}
                  className="w-9 px-0 text-red-400"
                  title="Delete staff member"
                  aria-label="Delete staff member"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
          </header>

          {/* Description card inside the hero when present */}
          {hasBody ? (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 md:p-5">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{member.body}</ReactMarkdown>
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
                describe the staff member&apos;s intent, system prompt, allowed
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
              Edit staff member
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function CreateStaffDialog({
  open,
  initialBody,
  onClose,
  onCreated,
}: {
  open: boolean;
  /**
   * Optional pre-filled body (e.g. from a "Draft with Kody" chat). When
   * provided, replaces the default STAFF_TEMPLATE starter.
   */
  initialBody?: string | null;
  onClose: () => void;
  onCreated: (member: Staff) => void;
}) {
  const { githubUser } = useGitHubIdentity();
  const createMutation = useCreateStaff(githubUser?.login);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState(STAFF_TEMPLATE);

  useEffect(() => {
    if (open) {
      setTitle("");
      setBody(initialBody && initialBody.trim() ? initialBody : STAFF_TEMPLATE);
    }
  }, [open, initialBody]);

  const handleSubmit = () => {
    if (!title.trim() || createMutation.isPending) return;
    createMutation.mutate(
      { title: title.trim(), body },
      {
        onSuccess: (member) => onCreated(member),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>New staff member</DialogTitle>
          <DialogDescription>
            Describe the staff member&apos;s intent, system prompt, allowed
            commands, and restrictions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="staff-title">Title</Label>
            <Input
              id="staff-title"
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
            {createMutation.isPending ? "Creating…" : "Create member"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditStaffDialog({
  member,
  onClose,
  onSaved,
}: {
  member: Staff;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { githubUser } = useGitHubIdentity();
  const updateMutation = useUpdateStaff(member.slug, githubUser?.login);

  const [title, setTitle] = useState(member.title);
  const [body, setBody] = useState(member.body || "");

  useEffect(() => {
    setTitle(member.title);
    setBody(member.body || "");
  }, [member]);

  const handleSubmit = () => {
    if (!title.trim() || updateMutation.isPending) return;
    const patch: {
      title?: string;
      body?: string;
    } = {};
    if (title !== member.title) patch.title = title.trim();
    if (body !== member.body) patch.body = body;
    if (Object.keys(patch).length === 0) {
      onSaved();
      return;
    }
    updateMutation.mutate(patch, { onSuccess: () => onSaved() });
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Edit staff member `{member.slug}`</DialogTitle>
          <DialogDescription>
            Update the staff member&apos;s title or body. Saving commits the file
            to the default branch.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-staff-title">Title</Label>
            <Input
              id="edit-staff-title"
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
