/**
 * @fileType component
 * @domain kody
 * @pattern duty-control-page
 * @ai-summary Duty Control — list, view, create, edit, and delete duties.
 *   A duty is a folder at `.kody/duties/<slug>/` in the connected repo:
 *   `profile.json` stores metadata and `duty.md` describes intent,
 *   allowed commands, and restrictions.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  Power,
  Plus,
  PowerOff,
  RefreshCw,
  Sparkles,
  Target,
  Timer,
  Trash2,
  User,
  UserCheck,
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
import { useAgents } from "../hooks/useAgents";
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
import {
  buildDutyWritesTo,
  defaultReportSlug,
  dutyOutputFromWritesTo,
  FALLBACK_REPORT_SLUG,
  normalizeReportSlug,
  type DutyOutputKind,
} from "../duties/output";
import { type Duty, type DutyCapabilityKind, type DutySchedule } from "../api";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmptyState } from "./EmptyState";
import { MasterDetailShell } from "./MasterDetailShell";
import { MarkdownEditor } from "./MarkdownEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "./SearchableSelect";
import { useChatScope } from "./ChatRailShell";
import { buildAuthHeaders, useAuth } from "../auth-context";

/** Order-insensitive equality for two login lists. */
function sameStringList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

function preventDialogEscapeWhenSearchableSelectOpen(event: {
  preventDefault: () => void;
}) {
  if (document.querySelector('[data-searchable-select-open="true"]')) {
    event.preventDefault();
  }
}

function slugifyAction(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64);
}

interface ExecutableSummary {
  slug: string;
  describe?: string;
}

const ALL_AGENT_FILTER = "__all_agent__";
const NO_AGENT_FILTER = "__no_agent__";
const ENABLED_STATUS_FILTER = "__enabled__";
const DISABLED_STATUS_FILTER = "__disabled__";
type DutyStatusFilterValue =
  | typeof ENABLED_STATUS_FILTER
  | typeof DISABLED_STATUS_FILTER;

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
  const [agentFilter, setAgentFilter] = useState(ALL_AGENT_FILTER);
  const [statusFilter, setStatusFilter] = useState<DutyStatusFilterValue>(
    ENABLED_STATUS_FILTER,
  );
  const { data: agentMembers = [] } = useAgents();
  const staffTitleBySlug = useMemo(
    () => new Map(agentMembers.map((s) => [s.slug, s.title])),
    [agentMembers],
  );
  const agentFilterOptions = useMemo(() => {
    const slugs = new Set<string>();
    agentMembers.forEach((s) => slugs.add(s.slug));
    duties.forEach((d) => {
      if (d.agent) slugs.add(d.agent);
    });
    return [...slugs].sort((a, b) =>
      (staffTitleBySlug.get(a) ?? a).localeCompare(
        staffTitleBySlug.get(b) ?? b,
      ),
    );
  }, [duties, agentMembers, staffTitleBySlug]);
  const hasDutiesWithoutAgent = useMemo(
    () => duties.some((d) => !d.agent),
    [duties],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matchesAgentFilter = (duty: Duty) => {
      if (agentFilter === ALL_AGENT_FILTER) return true;
      if (agentFilter === NO_AGENT_FILTER) return !duty.agent;
      return duty.agent === agentFilter;
    };
    const matchesStatusFilter = (duty: Duty) => {
      if (statusFilter === ENABLED_STATUS_FILTER) return !duty.disabled;
      return duty.disabled;
    };
    return duties.filter(
      (d) =>
        matchesAgentFilter(d) &&
        matchesStatusFilter(d) &&
        (!q ||
          d.slug.toLowerCase().includes(q) ||
          d.title.toLowerCase().includes(q) ||
          d.body.toLowerCase().includes(q) ||
          d.action.toLowerCase().includes(q) ||
          (d.executable?.toLowerCase().includes(q) ?? false) ||
          (d.agent?.toLowerCase().includes(q) ?? false) ||
          (d.reviewer?.toLowerCase().includes(q) ?? false) ||
          d.executables.some((e) => e.toLowerCase().includes(q))),
    );
  }, [duties, search, agentFilter, statusFilter]);

  useEffect(() => {
    if (filtered.length === 0) {
      if (selectedSlug) setSelectedSlug(null);
      return;
    }
    if (!selectedSlug || !filtered.some((duty) => duty.slug === selectedSlug)) {
      setSelectedSlug(filtered[0].slug);
    }
  }, [filtered, selectedSlug]);

  const { githubUser } = useGitHubIdentity();
  const deleteMutation = useDeleteDuty(githubUser?.login);
  const runMutation = useRunDuty();
  const updateMutation = useUpdateDuty(
    selectedDuty?.slug ?? "",
    githubUser?.login,
  );

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
          duties.length > 0 ? (
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <DutyAgentFilter
                  value={agentFilter}
                  onChange={setAgentFilter}
                  agentSlugs={agentFilterOptions}
                  staffTitleBySlug={staffTitleBySlug}
                  hasDutiesWithoutAgent={hasDutiesWithoutAgent}
                />
                <DutyStatusToggle
                  value={statusFilter}
                  onChange={setStatusFilter}
                />
              </div>
              <DutyHealthSummaryBar duties={duties} />
            </div>
          ) : null
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
              onEdit={() => {
                if (!selectedDuty.readOnly) setEditingDuty(selectedDuty);
              }}
              onDelete={() => {
                if (!selectedDuty.readOnly) setPendingDelete(selectedDuty);
              }}
              onRun={() =>
                runMutation.mutate({ slug: selectedDuty.slug, force: true })
              }
              onToggleEnabled={() => {
                if (!selectedDuty.readOnly) {
                  updateMutation.mutate({ disabled: !selectedDuty.disabled });
                }
              }}
              isRunning={
                runMutation.isPending &&
                runMutation.variables?.slug === selectedDuty.slug
              }
              isToggling={updateMutation.isPending}
            />
          ) : (
            <EmptyState
              icon={<Target />}
              title="Select a duty"
              hint="Pick a duty from the list to see its purpose and rules."
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
            hint="Create your first duty to describe the purpose, output, and restrictions."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Target />}
            title="No matching duties"
            hint="No duty matches the current filters."
          />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((duty) => {
              const isActive = selectedSlug === duty.slug;
              return (
                <li key={duty.slug}>
                  <button
                    type="button"
                    onClick={() => setSelectedSlug(duty.slug)}
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
                      {duty.source === "store" ? (
                        <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                          Store
                        </span>
                      ) : null}
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
                        <AtSign className="w-3 h-3" />
                        {duty.action}
                      </span>
                      {duty.executable ? (
                        <>
                          <span>·</span>
                          <span
                            className="inline-flex items-center gap-1"
                            title="Implementation executable"
                          >
                            <Boxes className="w-3 h-3" />
                            {duty.executable}
                          </span>
                        </>
                      ) : null}
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(duty.updatedAt).toLocaleDateString()}
                      </span>
                      <ScheduleInline schedule={duty.schedule} />
                      {duty.reviewer ? (
                        <span
                          className="inline-flex items-center gap-1"
                          title="Reviewer agent"
                        >
                          <UserCheck className="w-3 h-3" />
                          {duty.reviewer}
                        </span>
                      ) : null}
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

      {/* Create — writes the folder-backed duty structure. */}
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
  onToggleEnabled,
  isRunning,
  isToggling,
}: {
  duty: Duty;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRun: () => void;
  onToggleEnabled: () => void;
  isRunning: boolean;
  isToggling: boolean;
}) {
  const hasBody = duty.body.trim().length > 0;
  const toggleLabel = duty.disabled ? "Enable" : "Disable";
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
                {duty.source === "store" ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wide bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                    Store
                  </span>
                ) : null}
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
                <span
                  className="inline-flex items-center gap-1"
                  title="Public duty action"
                >
                  <AtSign className="w-3 h-3" />
                  {duty.action}
                </span>
                {duty.executable ? (
                  <>
                    <span>·</span>
                    <span
                      className="inline-flex items-center gap-1"
                      title="Implementation executable"
                    >
                      <Boxes className="w-3 h-3" />
                      {duty.executable}
                    </span>
                  </>
                ) : null}
                {duty.executables.length > 0 ? (
                  <>
                    <span>·</span>
                    <span
                      className="inline-flex items-center gap-1"
                      title="Legacy or multi-run executables"
                    >
                      <Boxes className="w-3 h-3" />
                      {duty.executables.join(", ")}
                    </span>
                  </>
                ) : null}
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  updated {new Date(duty.updatedAt).toLocaleDateString()}
                </span>
                <span>·</span>
                {duty.agent ? (
                  <span
                    className="inline-flex items-center gap-1"
                    title={`Runs as the ${duty.agent} agentIdentity`}
                  >
                    <User className="w-3 h-3" />
                    {duty.agent}
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 text-amber-400"
                    title="No agent assigned — the engine scheduler skips this duty"
                  >
                    <User className="w-3 h-3" />
                    no agent
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
                {duty.reviewer ? (
                  <span
                    className="inline-flex items-center gap-1"
                    title="Reviewer agent responsible for treating this duty's output"
                  >
                    <UserCheck className="w-3 h-3" />
                    {duty.reviewer}
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
                variant={duty.disabled ? "default" : "outline"}
                size="sm"
                onClick={onToggleEnabled}
                disabled={isToggling || duty.readOnly}
                className="w-9 px-0"
                title={
                  duty.readOnly
                    ? "Store-linked duties are read-only"
                    : `${toggleLabel} duty`
                }
                aria-label={`${toggleLabel} duty`}
              >
                {isToggling ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : duty.disabled ? (
                  <Power className="w-3.5 h-3.5" />
                ) : (
                  <PowerOff className="w-3.5 h-3.5" />
                )}
              </Button>
              <Button
                size="sm"
                onClick={onRun}
                disabled={isRunning}
                className="w-9 px-0 bg-emerald-500 text-white hover:bg-emerald-600"
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
                disabled={duty.readOnly}
                className="w-9 px-0"
                title={
                  duty.readOnly
                    ? "Store-linked duties are read-only"
                    : "Edit duty"
                }
                aria-label="Edit duty"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onDelete}
                disabled={duty.readOnly}
                className="w-9 px-0 text-red-400"
                title={
                  duty.readOnly
                    ? "Store-linked duties are read-only"
                    : "Delete duty"
                }
                aria-label="Delete duty"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </header>

          {/* Description card inside the hero when present */}
          {hasBody ? (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 md:p-5">
              <MarkdownPreview content={duty.body} variant="compact" />
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
                describe the duty&apos;s purpose, output, allowed commands, and
                restrictions.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={onEdit}
              disabled={duty.readOnly}
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
  const initialValues = useMemo(() => buildNewDutyFormValues(), [open]);

  const handleSubmit = (values: DutyFormSubmitValues) => {
    if (createMutation.isPending) return;
    createMutation.mutate(
      {
        title: values.title,
        body: values.body,
        schedule: values.schedule,
        capabilityKind: values.capabilityKind,
        disabled: false,
        agent: values.agent,
        reviewer: values.reviewer,
        action: values.action || undefined,
        executable: values.executable,
        writesTo: values.writesTo,
      },
      {
        onSuccess: (duty) => onCreated(duty),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent
        className="max-w-4xl"
        onEscapeKeyDown={preventDialogEscapeWhenSearchableSelectOpen}
      >
        <DialogHeader>
          <DialogTitle>New duty</DialogTitle>
          <DialogDescription>
            Describe the duty&apos;s purpose, output, allowed commands, and
            restrictions.
          </DialogDescription>
        </DialogHeader>

        <DutyForm
          initialValues={initialValues}
          titleId="duty-title"
          actionId="duty-action"
          simpleCreate
          autoBuildBody
          isPending={createMutation.isPending}
          submitLabel="Create duty"
          pendingLabel="Creating…"
          onCancel={onClose}
          onSubmit={handleSubmit}
        />
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
  const initialOutput = dutyOutputFromWritesTo(duty.writesTo);
  const initialValues = useMemo(() => buildDutyFormValues(duty), [duty]);

  const handleSubmit = (values: DutyFormSubmitValues) => {
    if (updateMutation.isPending) return;
    const patch: {
      title?: string;
    body?: string;
    schedule?: DutySchedule | null;
    capabilityKind?: DutyCapabilityKind | null;
    agent?: string | null;
      reviewer?: string | null;
      action?: string | null;
      executable?: string | null;
      writesTo?: string[];
    } = {};
    if (values.title !== duty.title) patch.title = values.title;
  if (values.body !== duty.body) patch.body = values.body;
  if (values.schedule !== duty.schedule) patch.schedule = values.schedule;
  if (values.capabilityKind !== duty.capabilityKind) {
    patch.capabilityKind = values.capabilityKind;
  }
    if (values.agent !== duty.agent) patch.agent = values.agent;
    if (values.reviewer !== duty.reviewer) patch.reviewer = values.reviewer;
    if (values.action !== duty.action) patch.action = values.action;
    if (values.executable !== duty.executable)
      patch.executable = values.executable;
    const outputChanged =
      values.outputKind !== initialOutput.outputKind ||
      normalizeReportSlug(values.reportSlug) !== initialOutput.reportSlug;
    if (outputChanged && !sameStringList(values.writesTo, duty.writesTo)) {
      patch.writesTo = values.writesTo;
    }
    if (Object.keys(patch).length === 0) {
      onSaved();
      return;
    }
    updateMutation.mutate(patch, { onSuccess: () => onSaved() });
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent
        className="max-w-4xl"
        onEscapeKeyDown={preventDialogEscapeWhenSearchableSelectOpen}
      >
        <DialogHeader>
          <DialogTitle>Edit duty `{duty.slug}`</DialogTitle>
          <DialogDescription>
            Update the duty&apos;s metadata, executable assignment, or body.
            Saving commits the file to the default branch.
          </DialogDescription>
        </DialogHeader>

        <DutyForm
          initialValues={initialValues}
          titleId="edit-duty-title"
          actionId="edit-duty-action"
          isPending={updateMutation.isPending}
          submitLabel="Save changes"
          pendingLabel="Saving…"
          onCancel={onClose}
          onSubmit={handleSubmit}
          timing={
            <DutyTimingReadout
              lastTickAt={duty.lastTickAt}
              nextEligibleAt={duty.nextEligibleAt}
            />
          }
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Inline "last run" pill for use in the duty-list rows. Hidden when
 * no run proof is visible — keeps the row dense. Refreshes every 30s.
 * Source is the duty state file or the newer activity log fallback.
 */
/**
 * Row pill that escalates a duty's raw timestamps into an actionable
 * warning: amber "Overdue" (next-eligible passed beyond the cron window),
 * red "Never run" (scheduled, old enough to have run, no proof yet), or
 * gray "No agent" (the scheduler skips it).
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
        title="Scheduled and old enough to have run, but the dashboard has no run proof."
      >
        <AlertTriangle className="w-2.5 h-2.5" />
        Never run
      </span>
    );
  }
  if (health === "skipped") {
    return (
      <span
        className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-white/[0.06] text-muted-foreground border border-white/[0.08]"
        title="No agent assigned — the engine scheduler skips this duty."
      >
        <User className="w-2.5 h-2.5" />
        No agent
      </span>
    );
  }
  return null;
}

/** Compact health bar; hidden when everything is healthy/runnable. */
function DutyHealthSummaryBar({ duties }: { duties: Duty[] }) {
  const now = useNow(30_000);
  const { overdue, never, skipped } = summarizeDutyHealth(
    duties,
    now.getTime(),
  );
  if (overdue === 0 && never === 0 && skipped === 0) return null;
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
          title="Scheduled duties with no visible run proof"
        >
          <AlertTriangle className="w-3 h-3" />
          {never} never run
        </span>
      ) : null}
      {skipped > 0 ? (
        <span
          className="inline-flex items-center gap-1 text-muted-foreground"
          title="Scheduled duties skipped because no agent is assigned"
        >
          <User className="w-3 h-3" />
          {skipped} no agent
        </span>
      ) : null}
    </div>
  );
}

function DutyStatusToggle({
  value,
  onChange,
}: {
  value: DutyStatusFilterValue;
  onChange: (next: DutyStatusFilterValue) => void;
}) {
  const options: Array<{ label: string; value: DutyStatusFilterValue }> = [
    { label: "Enabled", value: ENABLED_STATUS_FILTER },
    { label: "Disabled", value: DISABLED_STATUS_FILTER },
  ];
  return (
    <div
      className="grid h-9 grid-cols-2 gap-0.5 rounded-md border border-border bg-background/40 p-0.5"
      role="group"
      aria-label="Filter duties by status"
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded px-2.5 text-xs font-medium transition-colors",
              active
                ? "bg-white/10 text-white"
                : "text-muted-foreground hover:bg-white/[0.06] hover:text-white/85",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
function DutyAgentFilter({
  value,
  onChange,
  agentSlugs,
  staffTitleBySlug,
  hasDutiesWithoutAgent,
}: {
  value: string;
  onChange: (next: string) => void;
  agentSlugs: string[];
  staffTitleBySlug: Map<string, string>;
  hasDutiesWithoutAgent: boolean;
}) {
  const options: SearchableSelectOption[] = [
    { value: ALL_AGENT_FILTER, label: "All agent" },
    ...(hasDutiesWithoutAgent
      ? [{ value: NO_AGENT_FILTER, label: "No agent" }]
      : []),
    ...agentSlugs.map((slug) => {
      const title = staffTitleBySlug.get(slug);
      return {
        value: slug,
        label: title ? `${title} (${slug})` : slug,
        searchText: `${slug} ${title ?? ""}`,
      };
    }),
  ];
  return (
    <SearchableSelect
      value={value}
      onChange={(next) => onChange(next ?? ALL_AGENT_FILTER)}
      options={options}
      placeholder="All agent"
      searchPlaceholder="Search agent…"
      emptyLabel="No agent found"
    />
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
 * is missing. A null value means the dashboard can't see run proof, not
 * necessarily that the duty never ran.
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

const DUTY_CAPABILITY_KIND_OPTIONS: Array<{
  value: DutyCapabilityKind;
  label: string;
  summary: string;
}> = [
  {
    value: "observe",
    label: "Observe",
    summary: "Inspect and report facts.",
  },
  {
    value: "act",
    label: "Act",
    summary: "Make one change or trigger one operation.",
  },
  {
    value: "verify",
    label: "Verify",
    summary: "Confirm a specific claim with evidence.",
  },
];

function defaultOutputKindForCapabilityKind(
  capabilityKind: DutyCapabilityKind | null,
): DutyOutputKind {
  return capabilityKind === "act" ? "run" : "report";
}

function buildDutyBodyForCapabilityKind(
  capabilityKind: DutyCapabilityKind | null,
  outputKind: DutyOutputKind,
  reportSlug: string,
): string {
  const output =
    outputKind === "report"
      ? `\n## Output\n\nRefresh \`.kody/reports/${normalizeReportSlug(reportSlug)}.md\` with factual evidence.\n`
      : "\n## Output\n\nReturn the changed resources, status, and evidence.\n";

  if (capabilityKind === "act") {
    return `## Job\n\nPerform one requested change or trigger one operation.\n${output}\n## Allowed Commands\n\n- Run the selected executable.\n\n## Restrictions\n\n- Do not decide whether a larger goal is complete.\n- Report factual evidence only.\n`;
  }

  if (capabilityKind === "verify") {
    return `## Job\n\nConfirm whether one specific claim passed or failed.\n${output}\n## Allowed Commands\n\n- Inspect the relevant files, GitHub state, logs, reports, or preview.\n\n## Restrictions\n\n- Do not fix failures from this duty.\n- Return blockers and evidence when verification fails.\n`;
  }

  return `## Job\n\nInspect the target and report what is true.\n${output}\n## Allowed Commands\n\n- Read relevant files, GitHub state, logs, reports, or runtime output.\n\n## Restrictions\n\n- Do not make changes or dispatch repairs.\n- Keep findings factual and evidence-based.\n`;
}

interface DutyFormValues {
  title: string;
  body: string;
  schedule: DutySchedule | null;
  capabilityKind: DutyCapabilityKind | null;
  agent: string | null;
  reviewer: string | null;
  action: string;
  executable: string | null;
  outputKind: DutyOutputKind;
  reportSlug: string;
}

interface DutyFormSubmitValues {
  title: string;
  body: string;
  schedule: DutySchedule | null;
  capabilityKind: DutyCapabilityKind | null;
  agent: string | null;
  reviewer: string | null;
  action: string | null;
  executable: string | null;
  outputKind: DutyOutputKind;
  reportSlug: string;
  writesTo: string[];
}

function buildNewDutyFormValues(): DutyFormValues {
  const capabilityKind: DutyCapabilityKind = "observe";
  const outputKind = defaultOutputKindForCapabilityKind(capabilityKind);
  return {
    title: "",
    body: buildDutyBodyForCapabilityKind(
      capabilityKind,
      outputKind,
      FALLBACK_REPORT_SLUG,
    ),
    schedule: "manual",
    capabilityKind,
    agent: null,
    reviewer: null,
    action: "",
    executable: null,
    outputKind,
    reportSlug: FALLBACK_REPORT_SLUG,
  };
}

function buildDutyFormValues(duty: Duty): DutyFormValues {
  const output = dutyOutputFromWritesTo(duty.writesTo);
  return {
    title: duty.title,
    body: duty.body || "",
    schedule: duty.schedule,
    capabilityKind: duty.capabilityKind,
    agent: duty.agent,
    reviewer: duty.reviewer,
    action: duty.action,
    executable: duty.executable,
    outputKind: output.outputKind,
    reportSlug: output.reportSlug,
  };
}

function DutyForm({
  initialValues,
  titleId,
  actionId,
  simpleCreate = false,
  autoBuildBody = false,
  isPending,
  submitLabel,
  pendingLabel,
  onCancel,
  onSubmit,
  timing,
}: {
  initialValues: DutyFormValues;
  titleId: string;
  actionId: string;
  simpleCreate?: boolean;
  autoBuildBody?: boolean;
  isPending: boolean;
  submitLabel: string;
  pendingLabel: string;
  onCancel: () => void;
  onSubmit: (values: DutyFormSubmitValues) => void;
  timing?: ReactNode;
}) {
  const [title, setTitle] = useState(initialValues.title);
  const [body, setBody] = useState(initialValues.body);
  const [bodyTouched, setBodyTouched] = useState(false);
  const [capabilityKind, setCapabilityKind] =
    useState<DutyCapabilityKind | null>(initialValues.capabilityKind);
  const [agent, setAgent] = useState<string | null>(initialValues.agent);
  const [reviewer, setReviewer] = useState<string | null>(
    initialValues.reviewer,
  );
  const [action, setAction] = useState(initialValues.action);
  const [actionTouched, setActionTouched] = useState(false);
  const [schedule, setSchedule] = useState<DutySchedule | null>(
    initialValues.schedule,
  );
  const [outputKind, setOutputKind] = useState<DutyOutputKind>(
    initialValues.outputKind,
  );
  const [reportSlug, setReportSlug] = useState(initialValues.reportSlug);
  const [reportSlugTouched, setReportSlugTouched] = useState(false);
  const [executable, setExecutable] = useState<string | null>(
    initialValues.executable,
  );

  useEffect(() => {
    setTitle(initialValues.title);
    setBody(initialValues.body);
    setBodyTouched(false);
    setCapabilityKind(initialValues.capabilityKind);
    setAgent(initialValues.agent);
    setReviewer(initialValues.reviewer);
    setAction(initialValues.action);
    setActionTouched(false);
    setSchedule(initialValues.schedule);
    setOutputKind(initialValues.outputKind);
    setReportSlug(initialValues.reportSlug);
    setReportSlugTouched(false);
    setExecutable(initialValues.executable);
  }, [initialValues]);

  const updateTitle = (next: string) => {
    setTitle(next);
    if (!autoBuildBody) return;
    const nextAction = actionTouched ? action : slugifyAction(next);
    if (!actionTouched) setAction(nextAction);
    if (!reportSlugTouched) {
      const nextReportSlug = defaultReportSlug(nextAction, next);
      setReportSlug(nextReportSlug);
      if (!bodyTouched) {
        setBody(
          buildDutyBodyForCapabilityKind(
            capabilityKind,
            outputKind,
            nextReportSlug,
          ),
        );
      }
    }
  };

  const updateAction = (next: string) => {
    const nextAction = slugifyAction(next);
    setActionTouched(true);
    setAction(nextAction);
    if (!autoBuildBody || reportSlugTouched) return;
    const nextReportSlug = defaultReportSlug(nextAction, title);
    setReportSlug(nextReportSlug);
    if (!bodyTouched) {
      setBody(
        buildDutyBodyForCapabilityKind(
          capabilityKind,
          outputKind,
          nextReportSlug,
        ),
      );
    }
  };

  const updateCapabilityKind = (next: DutyCapabilityKind | null) => {
    setCapabilityKind(next);
    const nextOutputKind = defaultOutputKindForCapabilityKind(next);
    if (simpleCreate) setOutputKind(nextOutputKind);
    if (autoBuildBody && !bodyTouched) {
      setBody(
        buildDutyBodyForCapabilityKind(
          next,
          simpleCreate ? nextOutputKind : outputKind,
          reportSlug,
        ),
      );
    }
  };

  const updateOutputKind = (next: DutyOutputKind) => {
    setOutputKind(next);
    if (autoBuildBody && !bodyTouched) {
      setBody(buildDutyBodyForCapabilityKind(capabilityKind, next, reportSlug));
    }
  };

  const updateReportSlug = (next: string) => {
    setReportSlugTouched(true);
    setReportSlug(next);
    if (autoBuildBody && !bodyTouched) {
      setBody(
        buildDutyBodyForCapabilityKind(
          capabilityKind,
          outputKind,
          normalizeReportSlug(next),
        ),
      );
    }
  };

  const submit = () => {
    if (!title.trim() || isPending) return;
    onSubmit({
      title: title.trim(),
      body,
      schedule,
      capabilityKind,
      agent,
      reviewer,
      action: action.trim() || null,
      executable,
      outputKind,
      reportSlug,
      writesTo: buildDutyWritesTo(outputKind, reportSlug),
    });
  };

  return (
    <>
      <div className="space-y-4 mt-2">
        <div className="space-y-1.5">
          <Label htmlFor={titleId}>Title</Label>
          <Input
            id={titleId}
            value={title}
            onChange={(e) => updateTitle(e.target.value)}
            placeholder="e.g. Release notes manager"
            autoFocus
          />
        </div>
      <DutyCapabilityKindSelect
        value={capabilityKind}
        onChange={updateCapabilityKind}
        allowUnset={!simpleCreate}
      />
      {simpleCreate ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ScheduleSelect value={schedule} onChange={setSchedule} />
          <ExecutableSelect value={executable} onChange={setExecutable} />
        </div>
      ) : (
        <>
          <DutyActionScheduleRow
            actionId={actionId}
            action={action}
            onActionChange={updateAction}
            schedule={schedule}
            onScheduleChange={setSchedule}
          />
          <DutyExecutableOutputRow
            executable={executable}
            onExecutableChange={setExecutable}
            outputKind={outputKind}
            onOutputKindChange={updateOutputKind}
          />
        </>
      )}
      {!simpleCreate && outputKind === "report" ? (
          <div className="space-y-1.5">
            <Label htmlFor="duty-report-target">Report target</Label>
            <Input
              id="duty-report-target"
              value={reportSlug}
              onChange={(e) => updateReportSlug(e.target.value)}
              placeholder="release-notes-manager"
            />
            <p className="text-xs text-muted-foreground">
              Writes{" "}
              <strong>
                .kody/reports/{normalizeReportSlug(reportSlug)}.md
              </strong>
              .
            </p>
          </div>
        ) : null}
      <DutyAgentRoleRow
        agent={agent}
        onAgentChange={setAgent}
        reviewer={reviewer}
        onReviewerChange={setReviewer}
        hideReviewer={simpleCreate}
      />
        {timing}
        <div className="space-y-1.5">
          <Label>Body</Label>
          <MarkdownEditor
            value={body}
            onChange={(next) => {
              setBodyTouched(true);
              setBody(next);
            }}
            rows={14}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={submit}
          disabled={!title.trim() || isPending}
        >
          {isPending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </>
  );
}

function DutyExecutableOutputRow({
  executable,
  onExecutableChange,
  outputKind,
  onOutputKindChange,
}: {
  executable: string | null;
  onExecutableChange: (next: string | null) => void;
  outputKind: DutyOutputKind;
  onOutputKindChange: (next: DutyOutputKind) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <ExecutableSelect value={executable} onChange={onExecutableChange} />
      <OutputSelect value={outputKind} onChange={onOutputKindChange} />
    </div>
  );
}

function DutyCapabilityKindSelect({
  value,
  onChange,
  allowUnset,
}: {
  value: DutyCapabilityKind | null;
  onChange: (next: DutyCapabilityKind | null) => void;
  allowUnset: boolean;
}) {
  const options = allowUnset
    ? [
        {
          value: null,
          label: "Unset",
          summary: "Leave existing profile without a kind.",
        },
        ...DUTY_CAPABILITY_KIND_OPTIONS,
      ]
    : DUTY_CAPABILITY_KIND_OPTIONS;

  return (
    <div className="space-y-1.5">
      <Label>Kind</Label>
      <div
        className="grid gap-2 md:grid-cols-3"
        role="group"
        aria-label="Duty kind"
      >
        {options.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value ?? "unset"}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={cn(
                "min-h-16 rounded-md border px-3 py-2 text-left transition-colors",
                active
                  ? "border-emerald-400/50 bg-emerald-500/10 text-foreground"
                  : "border-border bg-background/40 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
              )}
            >
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="mt-1 block text-xs leading-4">
                {option.summary}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OutputSelect({
  value,
  onChange,
}: {
  value: DutyOutputKind;
  onChange: (next: DutyOutputKind) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="duty-output">Output</Label>
      <Select
        value={value}
        onValueChange={(next) => onChange(next as DutyOutputKind)}
      >
        <SelectTrigger id="duty-output" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="run" textValue="Run">
            Run
          </SelectItem>
          <SelectItem value="report" textValue="Report">
            Report
          </SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {value === "report"
          ? "Creates or refreshes one report."
          : "Runs without a generated report."}
      </p>
    </div>
  );
}

function DutyActionScheduleRow({
  actionId,
  action,
  onActionChange,
  schedule,
  onScheduleChange,
}: {
  actionId: string;
  action: string;
  onActionChange: (next: string) => void;
  schedule: DutySchedule | null;
  onScheduleChange: (next: DutySchedule | null) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor={actionId}>Action</Label>
        <Input
          id={actionId}
          value={action}
          onChange={(e) => onActionChange(e.target.value)}
          placeholder="e.g. release-notes"
        />
      </div>
      <ScheduleSelect value={schedule} onChange={onScheduleChange} />
    </div>
  );
}

/**
 * Schedule dropdown. Options, in order:
 *
 * - **Auto** (sentinel `null`, no explicit `every` in profile): the engine ticks the duty
 *   on every cron wake; the body's cadence guard decides whether to act.
 *   This is the default for every new duty.
 * - **Fixed cadences** (`every: 15m` … `every: 7d`): the engine gates the
 *   duty to that interval — it won't act more often than the chosen period,
 *   regardless of what the body says.
 * - **Manual only** (`every: manual`): the engine skips auto-ticks; the
 *   duty runs only when the Run button is clicked.
 *
 * `ALL_SCHEDULE_EVERY_OPTIONS` is the single source of truth (`15m`…`7d`,
 * then `manual`); the API schema and profile serializer accept the
 * same set, so every value here round-trips to `profile.json`.
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
      <Label htmlFor="duty-schedule">Cadence</Label>
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
 * Agent picker. A duty is *what* runs on a schedule; the agent is the agent
 * member whose agentIdentity the engine injects ahead of the duty body.
 */
function DutyAgentRoleRow({
  agent,
  onAgentChange,
  reviewer,
  onReviewerChange,
  hideReviewer = false,
}: {
  agent: string | null;
  onAgentChange: (next: string | null) => void;
  reviewer: string | null;
  onReviewerChange: (next: string | null) => void;
  hideReviewer?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <AgentSelect value={agent} onChange={onAgentChange} />
      {hideReviewer ? null : (
        <ReviewerSelect value={reviewer} onChange={onReviewerChange} />
      )}
    </div>
  );
}

function AgentSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const { data: agent, isLoading } = useAgents();
  const options: SearchableSelectOption[] = [
    { value: null, label: "None (duty won't run)" },
    ...withSelectedStaffFallback(agent ?? [], value).map((w) => ({
      value: w.slug,
      label: `${w.title} (${w.slug})`,
      searchText: `${w.slug} ${w.title}`,
    })),
  ];
  return (
    <div className="space-y-1.5">
<Label htmlFor="duty-agent">Agent</Label>
      <SearchableSelect
        id="duty-agent"
        value={value}
        onChange={onChange}
        options={options}
placeholder={isLoading ? "Loading agent…" : "Select agent"}
        searchPlaceholder="Search agent…"
        emptyLabel="No agent found"
        disabled={isLoading}
      />
      <p className="text-xs text-muted-foreground">
        {value ? (
          <>
            Runs as the <strong>{value}</strong> agentIdentity.
          </>
        ) : (
          <span className="text-amber-400">
            No agent assigned — the engine scheduler will skip this duty until
            you pick one.
          </span>
        )}
      </p>
    </div>
  );
}

function ReviewerSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const { data: agent, isLoading } = useAgents();
  const options: SearchableSelectOption[] = [
    { value: null, label: "None" },
    ...withSelectedStaffFallback(agent ?? [], value).map((w) => ({
      value: w.slug,
      label: `${w.title} (${w.slug})`,
      searchText: `${w.slug} ${w.title}`,
    })),
  ];
  return (
    <div className="space-y-1.5">
      <Label htmlFor="duty-reviewer" className="flex items-center gap-1.5">
        <UserCheck className="w-3.5 h-3.5 text-muted-foreground" />
        Reviewer
      </Label>
      <SearchableSelect
        id="duty-reviewer"
        value={value}
        onChange={onChange}
        options={options}
        placeholder={isLoading ? "Loading agent…" : "Select a reviewer"}
        searchPlaceholder="Search agent…"
        emptyLabel="No agent found"
        disabled={isLoading}
      />
      <p className="text-xs text-muted-foreground">
        Agent member responsible for reviewing or handling this duty&apos;s
        output.
      </p>
    </div>
  );
}

function withSelectedStaffFallback(
  agent: Array<{ slug: string; title: string }>,
  value: string | null,
): Array<{ slug: string; title: string }> {
  if (!value || agent.some((s) => s.slug === value)) return agent;
  return [{ slug: value, title: `Missing agent: ${value}` }, ...agent];
}

function ExecutableSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const {
    data: executables = [],
    error,
    isError,
    isLoading,
  } = useExecutableSummaries();
  const executableOptions =
    value && !executables.some((exec) => exec.slug === value)
      ? [{ slug: value }, ...executables]
      : executables;
  const options: SearchableSelectOption[] = [
    { value: null, label: "No executable" },
    ...executableOptions.map((exec) => ({
      value: exec.slug,
      label: exec.slug,
      description: exec.describe,
      searchText: `${exec.slug} ${exec.describe ?? ""}`,
    })),
  ];

  return (
    <div className="space-y-1.5">
      <Label htmlFor="duty-executable">Executable</Label>
      <SearchableSelect
        id="duty-executable"
        value={value}
        onChange={onChange}
        options={options}
        placeholder={isLoading ? "Loading executables…" : "Select executable"}
        searchPlaceholder="Search executables…"
        emptyLabel="No executables found"
        disabled={isLoading || isError}
      />
      {isError ? (
        <p className="px-1 text-xs text-rose-300">
          Failed to load executables: {(error as Error).message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Read-only timing readout shown inside the Edit dialog: last actual run
 * + next eligible run. Last run can come from state or activity; next eligible
 * still comes from state. Helpful for duties whose eligibility has runtime
 * evidence beyond the static profile cadence.
 * Refreshes every 30s.
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
  // Hide the readout entirely when neither signal is reachable — saying
  // "never run / next run unknown" on every duty misleads more than it informs.
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
