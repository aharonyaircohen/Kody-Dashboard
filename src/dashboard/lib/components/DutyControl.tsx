/**
 * @fileType component
 * @domain kody
 * @pattern duty-control-page
 * @ai-summary Duty Control — list, view, create, edit, and delete duties.
 *   A duty is a markdown file at `.kody/duties/<slug>.md` in the
 *   connected repo whose body describes the duty's intent, allowed
 *   commands, and restrictions.
 */
"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  AtSign,
  Boxes,
  Calendar,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  Pencil,
  Play,
  Plus,
  PowerOff,
  RefreshCw,
  Sparkles,
  Target,
  Timer,
  Trash2,
  User,
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
  useCreateDuty,
  useDeleteDuty,
  useDuties,
  useRunDuty,
  useUpdateDuty,
} from "../hooks/useDuties";
import { useStaff } from "../hooks/useStaff";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { useNow } from "../hooks/useNow";
import { formatDuration, formatRelativePast } from "../duties-schedule";
import {
  dutyScheduleHealth,
  summarizeDutyHealth,
} from "../duties/schedule-health";
import {
  scheduleEveryLabel,
  ALL_SCHEDULE_EVERY_OPTIONS,
} from "../duties-frontmatter";
import { getStoredAuth, type Duty, type DutySchedule } from "../api";
import { DUTY_TEMPLATE } from "../duty-template";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmptyState } from "./EmptyState";
import { MasterDetailShell } from "./MasterDetailShell";
import { MarkdownEditor } from "./MarkdownEditor";
import { useChatScope } from "./ChatRailShell";
import { buildAuthHeaders, useAuth } from "../auth-context";

/**
 * Parse the raw "Mentions" text field into a clean login list: split on
 * commas, trim, strip an optional leading `@`, drop empties. Matches the
 * frontmatter serializer's contract so the stored `mentions:` line is exact.
 */
function parseMentionsInput(raw: string): string[] {
  return raw
    .split(",")
    .map((m) => m.trim().replace(/^@/, ""))
    .filter((m) => m.length > 0);
}

/** Render a stored mentions list back into the comma-separated text field. */
function formatMentionsInput(mentions: string[]): string {
  return mentions.join(", ");
}

/** Order-insensitive equality for two login lists. */
function sameMentions(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

function sameList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

interface ExecutableSummary {
  slug: string;
  describe?: string;
}

const NO_EXECUTABLE_VALUE = "__none__";

function useExecutableSummaries() {
  const { auth } = useAuth();
  return useQuery({
    queryKey: ["kody-executables-list", auth?.owner, auth?.repo],
    queryFn: async (): Promise<ExecutableSummary[]> => {
      const res = await fetch("/api/kody/executables", {
        headers: {
          "content-type": "application/json",
          ...buildAuthHeaders(auth),
        },
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(json.message || json.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { executables?: ExecutableSummary[] };
      return data.executables ?? [];
    },
    enabled: !!auth,
    staleTime: 30_000,
  });
}

export function DutyControl() {
  return (
    <AuthGuard>
      <DutyControlInner />
    </AuthGuard>
  );
}

export function DutyControlInner() {
  const router = useRouter();
  const {
    data: duties = [],
    isLoading,
    isFetching,
    refetch,
    error,
  } = useDuties();

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingDuty, setEditingDuty] = useState<Duty | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Duty | null>(null);

  const selectedDuty = useMemo(
    () => duties.find((m) => m.slug === selectedSlug) ?? null,
    [duties, selectedSlug],
  );

  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return duties;
    return duties.filter(
      (d) =>
        d.slug.toLowerCase().includes(q) ||
        d.title.toLowerCase().includes(q) ||
        d.body.toLowerCase().includes(q) ||
        (d.staff?.toLowerCase().includes(q) ?? false) ||
        d.executables.some((e) => e.toLowerCase().includes(q)),
    );
  }, [duties, search]);

  useEffect(() => {
    if (!selectedSlug && duties.length > 0) {
      setSelectedSlug(duties[0].slug);
    }
  }, [duties, selectedSlug]);

  const { githubUser } = useGitHubIdentity();
  const deleteMutation = useDeleteDuty(githubUser?.login);
  const runMutation = useRunDuty();

  // Push chat context up to the persistent rail in the root layout.
  // The chat's context follows the currently selected duty (or nothing).
  // Clear on unmount.
  const { setScope } = useChatScope();
  useEffect(() => {
    setScope(selectedDuty ? { kind: "duty", duty: selectedDuty } : null);
    return () => setScope(null);
  }, [selectedDuty, setScope]);

  return (
    <>
      <MasterDetailShell
        title="Duty Control"
        icon={Target}
        iconClassName="text-emerald-400"
        subtitle={`${duties.length} ${duties.length === 1 ? "duty" : "duties"}`}
        error={
          error ? `Failed to load duties: ${(error as Error).message}` : null
        }
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search duties…"
        searchAriaLabel="Search duties"
        accent="emerald"
        hasSelection={!!selectedDuty}
        listAside={
          duties.length > 0 ? <DutyHealthSummaryBar duties={duties} /> : null
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label="Refresh duties"
            >
              <RefreshCw
                className={cn("w-4 h-4", isFetching && "animate-spin")}
              />
            </Button>
            <Button
              size="sm"
              className="w-9 px-0"
              onClick={() => setCreating(true)}
              title="New duty"
              aria-label="New duty"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </>
        }
        detail={
          selectedDuty ? (
            <DutyDetail
              duty={selectedDuty}
              onBack={() => setSelectedSlug(null)}
              onEdit={() => setEditingDuty(selectedDuty)}
              onDelete={() => setPendingDelete(selectedDuty)}
              onRun={() =>
                runMutation.mutate({ slug: selectedDuty.slug, force: true })
              }
              isRunning={
                runMutation.isPending &&
                runMutation.variables?.slug === selectedDuty.slug
              }
            />
          ) : (
            <EmptyState
              icon={<Target />}
              title="Select a duty"
              hint="Pick a duty from the list to see its intent and system prompt."
            />
          )
        }
      >
        {isLoading ? (
          <EmptyState icon={<FileText />} title="Loading duties…" />
        ) : duties.length === 0 ? (
          <EmptyState
            icon={<Target />}
            title="No duties yet"
            hint="Create your first duty to describe the intent, system prompt, and restrictions."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Target />}
            title="No matching duties"
            hint="No duty matches your search. Try a different term."
          />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((duty) => {
              const isActive = selectedSlug === duty.slug;
              return (
                <li key={duty.slug}>
                  <button
                    type="button"
                    onClick={() =>
                      duty.folder
                        ? router.push(`/executables/${duty.slug}`)
                        : setSelectedSlug(duty.slug)
                    }
                    className={cn(
                      "w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors relative",
                      isActive && "bg-accent/70",
                      duty.disabled && "opacity-60",
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
                        {duty.title}
                      </span>
                      {duty.disabled ? (
                        <span
                          className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-white/[0.06] text-muted-foreground border border-white/[0.08]"
                          title="Scheduler skips this duty. Manual Run still works."
                        >
                          <PowerOff className="w-2.5 h-2.5" />
                          Disabled
                        </span>
                      ) : (
                        <DutyHealthBadge duty={duty} />
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                      <span className="font-mono opacity-80">{duty.slug}</span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(duty.updatedAt).toLocaleDateString()}
                      </span>
                      <ScheduleInline schedule={duty.schedule} />
                      <LastTickInline
                        lastTickAt={duty.lastTickAt}
                        lastOutcome={duty.lastOutcome}
                        lastDurationMs={duty.lastDurationMs}
                      />
                      {!duty.disabled ? (
                        <NextRunInline
                          nextEligibleAt={duty.nextEligibleAt}
                          schedule={duty.schedule}
                        />
                      ) : null}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </MasterDetailShell>

      {/* Create — the simple markdown duty dialog. The full folder-duty editor
          lives at /executables. */}
      <CreateDutyDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(duty) => {
          setCreating(false);
          setSelectedSlug(duty.slug);
        }}
      />

      {/* Edit */}
      {editingDuty ? (
        <EditDutyDialog
          duty={editingDuty}
          onClose={() => setEditingDuty(null)}
          onSaved={() => setEditingDuty(null)}
        />
      ) : null}

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete this duty?"
        description={
          pendingDelete
            ? `Duty "${pendingDelete.title}" (${pendingDelete.slug}) will be removed from .kody/duties/ via a commit on the default branch.`
            : ""
        }
        variant="destructive"
        confirmLabel="Delete duty"
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
    </>
  );
}

function DutyDetail({
  duty,
  onBack,
  onEdit,
  onDelete,
  onRun,
  isRunning,
}: {
  duty: Duty;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRun: () => void;
  isRunning: boolean;
}) {
  const hasBody = duty.body.trim().length > 0;
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
            All duties
          </Button>
          <header className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1 space-y-2">
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight break-words inline-flex items-center gap-3 flex-wrap">
                <span>{duty.title}</span>
                {duty.disabled ? (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wide bg-white/[0.06] text-muted-foreground border border-white/[0.08]"
                    title="Scheduler skips this duty. Manual Run still works."
                  >
                    <PowerOff className="w-3 h-3" />
                    Disabled
                  </span>
                ) : null}
              </h1>
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                <span className="font-mono opacity-80">{duty.slug}</span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  updated {new Date(duty.updatedAt).toLocaleDateString()}
                </span>
                <span>·</span>
                {duty.staff ? (
                  <span
                    className="inline-flex items-center gap-1"
                    title={`Runs as the ${duty.staff} staff persona`}
                  >
                    <User className="w-3 h-3" />
                    {duty.staff}
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 text-amber-400"
                    title="No staff assigned — the engine scheduler skips this duty"
                  >
                    <User className="w-3 h-3" />
                    no staff
                  </span>
                )}
                {duty.mentions && duty.mentions.length > 0 ? (
                  <span
                    className="inline-flex items-center gap-1"
                    title="@-mentions these GitHub logins in its output"
                  >
                    <AtSign className="w-3 h-3" />
                    {duty.mentions.map((m) => `@${m}`).join(", ")}
                  </span>
                ) : null}
                {duty.executables.length > 0 ? (
                  <span
                    className="inline-flex items-center gap-1"
                    title="Executables assigned to this duty"
                  >
                    <Boxes className="w-3 h-3" />
                    {duty.executables.join(", ")}
                  </span>
                ) : null}
                <ScheduleInline schedule={duty.schedule} />
                <LastTickDetail
                  lastTickAt={duty.lastTickAt}
                  lastOutcome={duty.lastOutcome}
                  lastDurationMs={duty.lastDurationMs}
                />
                {!duty.disabled ? (
                  <NextRunDetail
                    nextEligibleAt={duty.nextEligibleAt}
                    schedule={duty.schedule}
                  />
                ) : null}
                <span>·</span>
                <a
                  href={duty.htmlUrl}
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
                className="w-9 px-0"
                title="Run duty now"
                aria-label="Run duty now"
              >
                {isRunning ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onEdit}
                className="w-9 px-0"
                title="Edit duty"
                aria-label="Edit duty"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onDelete}
                className="w-9 px-0 text-red-400"
                title="Delete duty"
                aria-label="Delete duty"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </header>

          {/* Description card inside the hero when present */}
          {hasBody ? (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 md:p-5">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{duty.body}</ReactMarkdown>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Empty body fallback below the hero (mirrors goal detail's empty tasks card) */}
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
                describe the duty&apos;s intent, system prompt, allowed
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
              Edit duty
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function CreateDutyDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (duty: Duty) => void;
}) {
  const { githubUser } = useGitHubIdentity();
  const createMutation = useCreateDuty(githubUser?.login);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState(DUTY_TEMPLATE);
  const [staff, setStaff] = useState<string | null>(null);
  const [mentions, setMentions] = useState("");
  const [executables, setExecutables] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setTitle("");
      setBody(DUTY_TEMPLATE);
      setStaff(null);
      setMentions("");
      setExecutables([]);
    }
  }, [open]);

  const handleSubmit = () => {
    if (!title.trim() || createMutation.isPending) return;
    createMutation.mutate(
      {
        title: title.trim(),
        body,
        // A duty isn't a timer: its core is executable + staff. Created
        // "manual" (never auto-fires) — schedule it later from the engine
        // if needed. Omitting `every` entirely would make the engine tick
        // it every cron wake, the opposite of what we want.
        schedule: "manual",
        staff,
        mentions: parseMentionsInput(mentions),
        executables,
      },
      {
        onSuccess: (duty) => onCreated(duty),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>New duty</DialogTitle>
          <DialogDescription>
            Describe the duty&apos;s intent, system prompt, allowed commands,
            and restrictions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="duty-title">Title</Label>
            <Input
              id="duty-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Release notes manager"
              autoFocus
            />
          </div>
          <StaffSelect value={staff} onChange={setStaff} />
          <ExecutablesSelect value={executables} onChange={setExecutables} />
          <MentionsInput value={mentions} onChange={setMentions} />
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
            {createMutation.isPending ? "Creating…" : "Create duty"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditDutyDialog({
  duty,
  onClose,
  onSaved,
}: {
  duty: Duty;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { githubUser } = useGitHubIdentity();
  const updateMutation = useUpdateDuty(duty.slug, githubUser?.login);

  const [title, setTitle] = useState(duty.title);
  const [body, setBody] = useState(duty.body || "");
  const [schedule, setSchedule] = useState<DutySchedule | null>(duty.schedule);
  const [staff, setStaff] = useState<string | null>(duty.staff);
  const [mentions, setMentions] = useState(formatMentionsInput(duty.mentions));
  const [executables, setExecutables] = useState<string[]>(duty.executables);

  useEffect(() => {
    setTitle(duty.title);
    setBody(duty.body || "");
    setSchedule(duty.schedule);
    setStaff(duty.staff);
    setMentions(formatMentionsInput(duty.mentions));
    setExecutables(duty.executables);
  }, [duty]);

  const handleSubmit = () => {
    if (!title.trim() || updateMutation.isPending) return;
    const patch: {
      title?: string;
      body?: string;
      schedule?: DutySchedule | null;
      staff?: string | null;
      mentions?: string[];
      executables?: string[];
    } = {};
    if (title !== duty.title) patch.title = title.trim();
    if (body !== duty.body) patch.body = body;
    if (schedule !== duty.schedule) patch.schedule = schedule;
    if (staff !== duty.staff) patch.staff = staff;
    const nextMentions = parseMentionsInput(mentions);
    if (!sameMentions(nextMentions, duty.mentions))
      patch.mentions = nextMentions;
    if (!sameList(executables, duty.executables))
      patch.executables = executables;
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
          <DialogTitle>Edit duty `{duty.slug}`</DialogTitle>
          <DialogDescription>
            Update the duty&apos;s metadata, executable assignment, or body.
            Saving commits the file to the default branch.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-duty-title">Title</Label>
            <Input
              id="edit-duty-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <ScheduleSelect value={schedule} onChange={setSchedule} />
          <StaffSelect value={staff} onChange={setStaff} />
          <ExecutablesSelect value={executables} onChange={setExecutables} />
          <MentionsInput value={mentions} onChange={setMentions} />
          <DutyTimingReadout
            lastTickAt={duty.lastTickAt}
            nextEligibleAt={duty.nextEligibleAt}
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
 * Inline "last run" pill for use in the duty-list rows. Hidden when
 * the duty has never run — keeps the row dense. Refreshes every 30s.
 * Source is the commit timestamp of the sibling `<slug>.state.json`,
 * which the engine writes only when a tick actually acts.
 */
/**
 * Row pill that escalates a duty's raw timestamps into an actionable
 * warning: amber "Overdue" (next-eligible passed beyond the cron window) or
 * red "Never run" (scheduled, old enough to have run, no state file yet).
 * Renders nothing for healthy/manual duties.
 */
function DutyHealthBadge({ duty }: { duty: Duty }) {
  const now = useNow(30_000);
  const health = dutyScheduleHealth(duty, now.getTime());
  if (health === "overdue") {
    return (
      <span
        className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-amber-500/15 text-amber-300 border border-amber-500/25"
        title="Past its next-eligible time by more than the cron window — the scheduler may be stuck."
      >
        <AlertTriangle className="w-2.5 h-2.5" />
        Overdue
      </span>
    );
  }
  if (health === "never") {
    return (
      <span
        className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-rose-500/15 text-rose-300 border border-rose-500/25"
        title="Scheduled and old enough to have run, but the engine has never recorded a tick."
      >
        <AlertTriangle className="w-2.5 h-2.5" />
        Never run
      </span>
    );
  }
  return null;
}

/** Compact "N overdue · M never run" bar; hidden when everything is healthy. */
function DutyHealthSummaryBar({ duties }: { duties: Duty[] }) {
  const now = useNow(30_000);
  const { overdue, never } = summarizeDutyHealth(duties, now.getTime());
  if (overdue === 0 && never === 0) return null;
  return (
    <div className="mt-2 flex items-center gap-3 text-[11px]">
      {overdue > 0 ? (
        <span
          className="inline-flex items-center gap-1 text-amber-300"
          title="Duties past their next-eligible time beyond the cron window"
        >
          <AlertTriangle className="w-3 h-3" />
          {overdue} overdue
        </span>
      ) : null}
      {never > 0 ? (
        <span
          className="inline-flex items-center gap-1 text-rose-300"
          title="Scheduled duties that have never recorded a tick"
        >
          <AlertTriangle className="w-3 h-3" />
          {never} never run
        </span>
      ) : null}
    </div>
  );
}

/**
 * Outcome + duration suffix for the "last run …" text. Only the failure case
 * is colored (red) — success is the silent default. Both come from the
 * engine-stamped `data.lastOutcome` / `data.lastDurationMs` (Phase 3).
 */
function RunResultSuffix({
  outcome,
  durationMs,
}: {
  outcome?: "completed" | "failed" | null;
  durationMs?: number | null;
}) {
  return (
    <>
      {outcome === "failed" ? (
        <span className="text-rose-400 font-medium">· failed</span>
      ) : null}
      {typeof durationMs === "number" && durationMs > 0 ? (
        <span className="opacity-70">· {formatDuration(durationMs)}</span>
      ) : null}
    </>
  );
}

function LastTickInline({
  lastTickAt,
  lastOutcome,
  lastDurationMs,
}: {
  lastTickAt: string | null;
  lastOutcome?: "completed" | "failed" | null;
  lastDurationMs?: number | null;
}) {
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
        <RunResultSuffix outcome={lastOutcome} durationMs={lastDurationMs} />
      </span>
    </>
  );
}

/**
 * Inline "next run in X" pill — the actual next-eligible time the duty
 * will act, sourced from `data.nextEligibleISO` in the duty's state JSON.
 * Hidden when the value is missing (duty hasn't run yet, or its body
 * doesn't emit the field) or when the schedule is `manual` — in that
 * case the `ScheduleInline` pill already says "manual only", which is
 * the whole story.
 */
function NextRunInline({
  nextEligibleAt,
  schedule,
}: {
  nextEligibleAt: string | null;
  schedule: DutySchedule | null;
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
 * is missing or the schedule is `manual` — same reasoning as the inline
 * pill.
 */
function NextRunDetail({
  nextEligibleAt,
  schedule,
}: {
  nextEligibleAt: string | null;
  schedule: DutySchedule | null;
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
 * is missing — `lastTickAt` is the commit timestamp of `<slug>.state.json`
 * on GitHub, which only exists for repos using the `contents-api` duty-state
 * backend. Repos on `local-file` keep state on the runner only, so a null
 * value means "the dashboard can't see it", not "never run". Saying "never
 * run" misleads more than it informs.
 */
function LastTickDetail({
  lastTickAt,
  lastOutcome,
  lastDurationMs,
}: {
  lastTickAt: string | null;
  lastOutcome?: "completed" | "failed" | null;
  lastDurationMs?: number | null;
}) {
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
        <RunResultSuffix outcome={lastOutcome} durationMs={lastDurationMs} />
      </span>
    </>
  );
}

/**
 * Schedule dropdown. Options, in order:
 *
 * - **Auto** (sentinel `null`, no frontmatter): the engine ticks the duty
 *   on every cron wake; the body's cadence guard decides whether to act.
 *   This is the default for every new duty.
 * - **Fixed cadences** (`every: 15m` … `every: 7d`): the engine gates the
 *   duty to that interval — it won't act more often than the chosen period,
 *   regardless of what the body says.
 * - **Manual only** (`every: manual`): the engine skips auto-ticks; the
 *   duty runs only when the Run button is clicked.
 *
 * `ALL_SCHEDULE_EVERY_OPTIONS` is the single source of truth (`15m`…`7d`,
 * then `manual`); the API schema and frontmatter serializer accept the
 * same set, so every value here round-trips to `every:` in the file.
 */
function ScheduleSelect({
  value,
  onChange,
}: {
  value: DutySchedule | null;
  onChange: (next: DutySchedule | null) => void;
}) {
  // Sentinel because Radix Select.Item disallows empty-string values; we
  // can't bind `null` directly to it.
  const AUTO = "__auto__";
  return (
    <div className="space-y-1.5">
      <Label htmlFor="duty-schedule">Schedule</Label>
      <Select
        value={value ?? AUTO}
        onValueChange={(v) => onChange(v === AUTO ? null : (v as DutySchedule))}
      >
        <SelectTrigger id="duty-schedule" className="w-full">
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
        <strong>Auto</strong> — the body&apos;s cadence guard decides when to
        run. A <strong>fixed cadence</strong> caps how often it can act.{" "}
        <strong>Manual only</strong> — never auto-runs; click Run to trigger.
      </p>
    </div>
  );
}

/**
 * Staff (persona) picker. A duty is *what* runs on a schedule; the staff
 * member it names is *who* runs it — the engine injects that persona ahead
 * of the duty body. Every duty must name a staff member: the engine
 * scheduler skips duties with none, so the picker warns when unset and
 * offers the personas under `.kody/staff/`.
 */
function StaffSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const { data: staff, isLoading } = useStaff();
  // Radix Select.Item disallows empty-string values; bind `null` to a
  // sentinel instead.
  const NONE = "__none__";
  return (
    <div className="space-y-1.5">
      <Label htmlFor="duty-staff">Staff</Label>
      <Select
        value={value ?? NONE}
        onValueChange={(v) => onChange(v === NONE ? null : v)}
      >
        <SelectTrigger id="duty-staff" className="w-full">
          <SelectValue
            placeholder={isLoading ? "Loading staff…" : "Select a staff member"}
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>None (duty won&apos;t run)</SelectItem>
          {(staff ?? []).map((w) => (
            <SelectItem key={w.slug} value={w.slug}>
              {w.title} ({w.slug})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {value ? (
          <>
            Runs as the <strong>{value}</strong> persona.
          </>
        ) : (
          <span className="text-amber-400">
            No staff assigned — the engine scheduler will skip this duty until
            you pick one.
          </span>
        )}
      </p>
    </div>
  );
}

function ExecutablesSelect({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const {
    data: executables = [],
    error,
    isError,
    isLoading,
  } = useExecutableSummaries();
  const selected = value[0] ?? NO_EXECUTABLE_VALUE;
  const options =
    value[0] && !executables.some((exec) => exec.slug === value[0])
      ? [{ slug: value[0] }, ...executables]
      : executables;

  return (
    <div className="space-y-1.5">
      <Label htmlFor="duty-executable">Executable</Label>
      <Select
        value={selected}
        onValueChange={(next) =>
          onChange(next === NO_EXECUTABLE_VALUE ? [] : [next])
        }
        disabled={isLoading || isError || options.length === 0}
      >
        <SelectTrigger id="duty-executable">
          <SelectValue
            placeholder={
              isLoading ? "Loading executables…" : "Select executable"
            }
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_EXECUTABLE_VALUE}>No executable</SelectItem>
          {options.map((exec) => (
            <SelectItem key={exec.slug} value={exec.slug}>
              {exec.slug}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isError ? (
        <p className="px-1 text-xs text-rose-300">
          Failed to load executables: {(error as Error).message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * "Mentions" input — a comma-separated list of GitHub logins the duty's
 * output should `@`-mention. Stored as the `mentions:` frontmatter line
 * (no `@`); the engine pings the listed users in the duty's report. The
 * raw text is normalized on save (split, trim, strip leading `@`, drop
 * empties) so users can type `@alice, bob` freely.
 */
/**
 * Comma-separated GitHub logins with collaborator autocomplete. The login
 * being typed is the text after the last comma; matching repo collaborators
 * (from `/api/kody/collaborators`, the same source as the comment composer)
 * are suggested and complete that token on click / Enter / Tab. Storage stays
 * the plain comma-separated string — `parseMentionsInput` is unchanged.
 */
function MentionsInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [collaborators, setCollaborators] = useState<{ login: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const auth = getStoredAuth();
    fetch("/api/kody/collaborators", {
      headers: auth
        ? {
            "x-kody-token": auth.token,
            "x-kody-owner": auth.owner,
            "x-kody-repo": auth.repo,
          }
        : {},
    })
      .then((r) => (r.ok ? r.json() : { collaborators: [] }))
      .then((d) => {
        if (!cancelled) setCollaborators(d.collaborators ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const lastComma = value.lastIndexOf(",");
  const head = lastComma >= 0 ? value.slice(0, lastComma + 1) : "";
  const token = value
    .slice(lastComma + 1)
    .trim()
    .replace(/^@/, "")
    .toLowerCase();

  const chosen = useMemo(
    () =>
      new Set(
        value
          .split(",")
          .map((s) => s.trim().replace(/^@/, "").toLowerCase())
          .filter(Boolean),
      ),
    [value],
  );

  const suggestions = useMemo(
    () =>
      collaborators
        .filter(
          (c) =>
            !chosen.has(c.login.toLowerCase()) ||
            c.login.toLowerCase() === token,
        )
        .filter(
          (c) => token.length === 0 || c.login.toLowerCase().includes(token),
        )
        .slice(0, 6),
    [collaborators, chosen, token],
  );

  const showList = open && suggestions.length > 0;

  function choose(login: string) {
    onChange(`${head ? `${head} ` : ""}${login}, `);
    setOpen(false);
    setActiveIdx(0);
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="duty-mentions" className="flex items-center gap-1.5">
        <AtSign className="w-3.5 h-3.5 text-muted-foreground" />
        Mentions
      </Label>
      <div className="relative">
        <Input
          id="duty-mentions"
          value={value}
          autoComplete="off"
          placeholder="e.g. aguyaharonyair, alice"
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActiveIdx(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!showList) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIdx((i) => (i + 1) % suggestions.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIdx(
                (i) => (i - 1 + suggestions.length) % suggestions.length,
              );
            } else if (e.key === "Enter" || e.key === "Tab") {
              const sel = suggestions[activeIdx] ?? suggestions[0];
              if (sel) {
                e.preventDefault();
                choose(sel.login);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {showList && (
          <ul className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-md border bg-popover py-1 shadow-md">
            {suggestions.map((c, i) => (
              <li key={c.login}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 px-2 py-1 text-left text-sm ${
                    i === activeIdx
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  }`}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(c.login);
                  }}
                >
                  <AtSign className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{c.login}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Comma-separated GitHub logins to <strong>@</strong>-mention in this
        duty&apos;s output. Leave blank for none.
      </p>
    </div>
  );
}

/**
 * Read-only timing readout shown inside the Edit dialog: last actual run
 * + next eligible run, both sourced from the duty's state file. Helpful
 * for duties whose cadence lives in the body prose (not frontmatter), so
 * the dropdown above can't honestly express it. Refreshes every 30s.
 */
function DutyTimingReadout({
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
  // Both signals come from `<slug>.state.json` on GitHub, which only exists
  // for repos on the `contents-api` duty-state backend. Hide the readout
  // entirely when neither is reachable — saying "never run / next run
  // unknown" on every duty misleads more than it informs.
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
function ScheduleInline({ schedule }: { schedule: DutySchedule | null }) {
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
