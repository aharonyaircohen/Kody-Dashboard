/**
 * @fileType component
 * @domain kody
 * @pattern agentResponsibility-control-page
 * @ai-summary AgentResponsibility Control — list, view, create, edit, and delete agentResponsibilities.
 *   A agentResponsibility is a folder at `agent-responsibilities/<slug>/` in the state repo:
 *   `profile.json` stores metadata and `agent-responsibility.md` describes intent,
 *   allowed commands, and restrictions.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
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
  useCreateAgentResponsibility,
  useDeleteAgentResponsibility,
  useAgentResponsibilities,
  useRunAgentResponsibility,
  useUpdateAgentResponsibility,
} from "../hooks/useAgentResponsibilities";
import { useAgents } from "../hooks/useAgents";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";
import { useNow } from "../hooks/useNow";
import {
  formatDuration,
  formatRelativePast,
} from "../agent-responsibilities-schedule";
import {
  ALL_SCHEDULE_EVERY_OPTIONS,
  scheduleEveryLabel,
  type ScheduleEvery,
} from "../agent-responsibilities-frontmatter";
import {
  type AgentResponsibility,
  type AgentResponsibilityCapabilityKind,
} from "../api";
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

interface AgentActionSummary {
  slug: string;
  describe?: string;
}

const ALL_AGENT_FILTER = "__all_agent__";
const NO_AGENT_FILTER = "__no_agent__";
const ENABLED_STATUS_FILTER = "__enabled__";
const DISABLED_STATUS_FILTER = "__disabled__";
type AgentResponsibilityStatusFilterValue =
  | typeof ENABLED_STATUS_FILTER
  | typeof DISABLED_STATUS_FILTER;

function useAgentActionSummaries() {
  const { auth } = useAuth();
  return useQuery({
    queryKey: ["kody-agentActions-list", auth?.owner, auth?.repo],
    queryFn: async (): Promise<AgentActionSummary[]> => {
      const res = await fetch("/api/kody/agent-actions", {
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
      const data = (await res.json()) as {
        agentActions?: AgentActionSummary[];
      };
      return data.agentActions ?? [];
    },
    enabled: !!auth,
    staleTime: 30_000,
  });
}

export function AgentResponsibilityControl() {
  return (
    <AuthGuard>
      <AgentResponsibilityControlInner />
    </AuthGuard>
  );
}

export function AgentResponsibilityControlInner() {
  const {
    data: agentResponsibilities = [],
    isLoading,
    isFetching,
    refetch,
    error,
  } = useAgentResponsibilities();

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingAgentResponsibility, setEditingAgentResponsibility] =
    useState<AgentResponsibility | null>(null);
  const [pendingDelete, setPendingDelete] =
    useState<AgentResponsibility | null>(null);

  const selectedAgentResponsibility = useMemo(
    () => agentResponsibilities.find((m) => m.slug === selectedSlug) ?? null,
    [agentResponsibilities, selectedSlug],
  );

  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState(ALL_AGENT_FILTER);
  const [statusFilter, setStatusFilter] =
    useState<AgentResponsibilityStatusFilterValue>(ENABLED_STATUS_FILTER);
  const { data: agentMembers = [] } = useAgents();
  const staffTitleBySlug = useMemo(
    () => new Map(agentMembers.map((s) => [s.slug, s.title])),
    [agentMembers],
  );
  const agentFilterOptions = useMemo(() => {
    const slugs = new Set<string>();
    agentMembers.forEach((s) => slugs.add(s.slug));
    agentResponsibilities.forEach((d) => {
      if (d.agent) slugs.add(d.agent);
    });
    return [...slugs].sort((a, b) =>
      (staffTitleBySlug.get(a) ?? a).localeCompare(
        staffTitleBySlug.get(b) ?? b,
      ),
    );
  }, [agentResponsibilities, agentMembers, staffTitleBySlug]);
  const hasAgentResponsibilitiesWithoutAgent = useMemo(
    () => agentResponsibilities.some((d) => !d.agent),
    [agentResponsibilities],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matchesAgentFilter = (agentResponsibility: AgentResponsibility) => {
      if (agentFilter === ALL_AGENT_FILTER) return true;
      if (agentFilter === NO_AGENT_FILTER) return !agentResponsibility.agent;
      return agentResponsibility.agent === agentFilter;
    };
    const matchesStatusFilter = (agentResponsibility: AgentResponsibility) => {
      if (statusFilter === ENABLED_STATUS_FILTER)
        return !agentResponsibility.disabled;
      return agentResponsibility.disabled;
    };
    return agentResponsibilities.filter(
      (d) =>
        matchesAgentFilter(d) &&
        matchesStatusFilter(d) &&
        (!q ||
          d.slug.toLowerCase().includes(q) ||
          d.title.toLowerCase().includes(q) ||
          d.body.toLowerCase().includes(q) ||
          d.action.toLowerCase().includes(q) ||
          (d.agentAction?.toLowerCase().includes(q) ?? false) ||
          (d.agent?.toLowerCase().includes(q) ?? false) ||
          (d.reviewer?.toLowerCase().includes(q) ?? false) ||
          d.agentActions.some((e) => e.toLowerCase().includes(q))),
    );
  }, [agentResponsibilities, search, agentFilter, statusFilter]);

  useEffect(() => {
    if (filtered.length === 0) {
      if (selectedSlug) setSelectedSlug(null);
      return;
    }
    if (
      !selectedSlug ||
      !filtered.some(
        (agentResponsibility) => agentResponsibility.slug === selectedSlug,
      )
    ) {
      setSelectedSlug(filtered[0].slug);
    }
  }, [filtered, selectedSlug]);

  const { githubUser } = useGitHubIdentity();
  const deleteMutation = useDeleteAgentResponsibility(githubUser?.login);
  const runMutation = useRunAgentResponsibility();
  const updateMutation = useUpdateAgentResponsibility(
    selectedAgentResponsibility?.slug ?? "",
    githubUser?.login,
  );

  // Push chat context up to the persistent rail in the root layout.
  // The chat's context follows the currently selected agentResponsibility (or nothing).
  // Clear on unmount.
  const { setScope } = useChatScope();
  useEffect(() => {
    setScope(
      selectedAgentResponsibility
        ? {
            kind: "agentResponsibility",
            agentResponsibility: selectedAgentResponsibility,
          }
        : null,
    );
    return () => setScope(null);
  }, [selectedAgentResponsibility, setScope]);

  return (
    <>
      <MasterDetailShell
        title="Responsibilities"
        icon={Target}
        iconClassName="text-emerald-400"
        subtitle={`${agentResponsibilities.length} ${agentResponsibilities.length === 1 ? "agentResponsibility" : "agent-responsibilities"}`}
        error={
          error
            ? `Failed to load agentResponsibilities: ${(error as Error).message}`
            : null
        }
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search agentResponsibilities…"
        searchAriaLabel="Search agentResponsibilities"
        accent="emerald"
        hasSelection={!!selectedAgentResponsibility}
        listAside={
          agentResponsibilities.length > 0 ? (
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <AgentResponsibilityAgentFilter
                  value={agentFilter}
                  onChange={setAgentFilter}
                  agentSlugs={agentFilterOptions}
                  staffTitleBySlug={staffTitleBySlug}
                  hasAgentResponsibilitiesWithoutAgent={
                    hasAgentResponsibilitiesWithoutAgent
                  }
                />
                <AgentResponsibilityStatusToggle
                  value={statusFilter}
                  onChange={setStatusFilter}
                />
              </div>
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
              aria-label="Refresh agentResponsibilities"
            >
              <RefreshCw
                className={cn("w-4 h-4", isFetching && "animate-spin")}
              />
            </Button>
            <Button
              size="sm"
              className="w-9 px-0"
              onClick={() => setCreating(true)}
              title="New agentResponsibility"
              aria-label="New agentResponsibility"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </>
        }
        detail={
          selectedAgentResponsibility ? (
            <AgentResponsibilityDetail
              agentResponsibility={selectedAgentResponsibility}
              onBack={() => setSelectedSlug(null)}
              onEdit={() => {
                if (!selectedAgentResponsibility.readOnly)
                  setEditingAgentResponsibility(selectedAgentResponsibility);
              }}
              onDelete={() => {
                setPendingDelete(selectedAgentResponsibility);
              }}
              onRun={() =>
                runMutation.mutate({
                  slug: selectedAgentResponsibility.slug,
                  force: true,
                })
              }
              onToggleEnabled={() => {
                if (!selectedAgentResponsibility.readOnly) {
                  updateMutation.mutate({
                    disabled: !selectedAgentResponsibility.disabled,
                  });
                }
              }}
              isRunning={
                runMutation.isPending &&
                runMutation.variables?.slug === selectedAgentResponsibility.slug
              }
              isToggling={updateMutation.isPending}
            />
          ) : (
            <EmptyState
              icon={<Target />}
              title="Select a agentResponsibility"
              hint="Pick a agentResponsibility from the list to see its purpose and rules."
            />
          )
        }
      >
        {isLoading ? (
          <EmptyState
            icon={<FileText />}
            title="Loading agentResponsibilities…"
          />
        ) : agentResponsibilities.length === 0 ? (
          <EmptyState
            icon={<Target />}
            title="No agentResponsibilities yet"
            hint="Create your first agentResponsibility to describe the purpose, and restrictions."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Target />}
            title="No matching agentResponsibilities"
            hint="No agentResponsibility matches the current filters."
          />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((agentResponsibility) => {
              const isActive = selectedSlug === agentResponsibility.slug;
              return (
                <li key={agentResponsibility.slug}>
                  <button
                    type="button"
                    onClick={() => setSelectedSlug(agentResponsibility.slug)}
                    className={cn(
                      "w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors relative",
                      isActive && "bg-accent/70",
                      agentResponsibility.disabled && "opacity-60",
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
                        {agentResponsibility.title}
                      </span>
                      {agentResponsibility.source === "store" ? (
                        <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                          Store
                        </span>
                      ) : null}
                      {agentResponsibility.disabled ? (
                        <span
                          className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-white/[0.06] text-muted-foreground border border-white/[0.08]"
                          title="Disabled for runner dispatch. Manual Run still works."
                        >
                          <PowerOff className="w-2.5 h-2.5" />
                          Disabled
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                      <span className="font-mono opacity-80">
                        {agentResponsibility.slug}
                      </span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <AtSign className="w-3 h-3" />
                        {agentResponsibility.action}
                      </span>
                      {agentResponsibility.agentAction ? (
                        <>
                          <span>·</span>
                          <span
                            className="inline-flex items-center gap-1"
                            title="Implementation agentAction"
                          >
                            <Boxes className="w-3 h-3" />
                            {agentResponsibility.agentAction}
                          </span>
                        </>
                      ) : null}
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(
                          agentResponsibility.updatedAt,
                        ).toLocaleDateString()}
                      </span>
                      {agentResponsibility.reviewer ? (
                        <span
                          className="inline-flex items-center gap-1"
                          title="Reviewer agent"
                        >
                          <UserCheck className="w-3 h-3" />
                          {agentResponsibility.reviewer}
                        </span>
                      ) : null}
                      <LastTickInline
                        lastTickAt={agentResponsibility.lastTickAt}
                        lastOutcome={agentResponsibility.lastOutcome}
                        lastDurationMs={agentResponsibility.lastDurationMs}
                      />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </MasterDetailShell>

      {/* Create — writes the folder-backed agentResponsibility structure. */}
      <CreateAgentResponsibilityDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(agentResponsibility) => {
          setCreating(false);
          setSelectedSlug(agentResponsibility.slug);
        }}
      />

      {/* Edit */}
      {editingAgentResponsibility ? (
        <EditAgentResponsibilityDialog
          agentResponsibility={editingAgentResponsibility}
          onClose={() => setEditingAgentResponsibility(null)}
          onSaved={() => setEditingAgentResponsibility(null)}
        />
      ) : null}

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!pendingDelete}
        title={
          pendingDelete?.source === "store"
            ? "Remove Store agentResponsibility?"
            : "Delete this agentResponsibility?"
        }
        description={
          pendingDelete
            ? pendingDelete.source === "store"
              ? `AgentResponsibility "${pendingDelete.title}" (${pendingDelete.slug}) will be removed from this repo's active Store responsibilities. The Store asset will not be deleted.`
              : `AgentResponsibility "${pendingDelete.title}" (${pendingDelete.slug}) will be removed from the state repo responsibility store.`
            : ""
        }
        variant="destructive"
        confirmLabel={
          pendingDelete?.source === "store"
            ? "Remove agentResponsibility"
            : "Delete agentResponsibility"
        }
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

function AgentResponsibilityDetail({
  agentResponsibility,
  onBack,
  onEdit,
  onDelete,
  onRun,
  onToggleEnabled,
  isRunning,
  isToggling,
}: {
  agentResponsibility: AgentResponsibility;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRun: () => void;
  onToggleEnabled: () => void;
  isRunning: boolean;
  isToggling: boolean;
}) {
  const hasBody = agentResponsibility.body.trim().length > 0;
  const toggleLabel = agentResponsibility.disabled ? "Enable" : "Disable";
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
            All agentResponsibilities
          </Button>
          <header className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1 space-y-2">
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight break-words inline-flex items-center gap-3 flex-wrap">
                <span>{agentResponsibility.title}</span>
                {agentResponsibility.source === "store" ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wide bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                    Store
                  </span>
                ) : null}
                {agentResponsibility.disabled ? (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium uppercase tracking-wide bg-white/[0.06] text-muted-foreground border border-white/[0.08]"
                    title="Disabled for runner dispatch. Manual Run still works."
                  >
                    <PowerOff className="w-3 h-3" />
                    Disabled
                  </span>
                ) : null}
              </h1>
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                <span className="font-mono opacity-80">
                  {agentResponsibility.slug}
                </span>
                <span>·</span>
                <span
                  className="inline-flex items-center gap-1"
                  title="Public agentResponsibility action"
                >
                  <AtSign className="w-3 h-3" />
                  {agentResponsibility.action}
                </span>
                {agentResponsibility.agentAction ? (
                  <>
                    <span>·</span>
                    <span
                      className="inline-flex items-center gap-1"
                      title="Implementation agentAction"
                    >
                      <Boxes className="w-3 h-3" />
                      {agentResponsibility.agentAction}
                    </span>
                  </>
                ) : null}
                {agentResponsibility.agentActions.length > 0 ? (
                  <>
                    <span>·</span>
                    <span
                      className="inline-flex items-center gap-1"
                      title="Legacy or multi-run agentActions"
                    >
                      <Boxes className="w-3 h-3" />
                      {agentResponsibility.agentActions.join(", ")}
                    </span>
                  </>
                ) : null}
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  updated{" "}
                  {new Date(agentResponsibility.updatedAt).toLocaleDateString()}
                </span>
                <span>·</span>
                {agentResponsibility.agent ? (
                  <span
                    className="inline-flex items-center gap-1"
                    title={`Runs as the ${agentResponsibility.agent} agentIdentity`}
                  >
                    <User className="w-3 h-3" />
                    {agentResponsibility.agent}
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 text-amber-400"
                    title="No agent assigned"
                  >
                    <User className="w-3 h-3" />
                    no agent
                  </span>
                )}
                {agentResponsibility.mentions &&
                agentResponsibility.mentions.length > 0 ? (
                  <span
                    className="inline-flex items-center gap-1"
                    title="@-mentions these GitHub logins in its output"
                  >
                    <AtSign className="w-3 h-3" />
                    {agentResponsibility.mentions
                      .map((m) => `@${m}`)
                      .join(", ")}
                  </span>
                ) : null}
                {agentResponsibility.reviewer ? (
                  <span
                    className="inline-flex items-center gap-1"
                    title="Reviewer agent responsible for treating this agentResponsibility's output"
                  >
                    <UserCheck className="w-3 h-3" />
                    {agentResponsibility.reviewer}
                  </span>
                ) : null}
                <LastTickDetail
                  lastTickAt={agentResponsibility.lastTickAt}
                  lastOutcome={agentResponsibility.lastOutcome}
                  lastDurationMs={agentResponsibility.lastDurationMs}
                />
                <span>·</span>
                <a
                  href={agentResponsibility.htmlUrl}
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
                variant={agentResponsibility.disabled ? "default" : "outline"}
                size="sm"
                onClick={onToggleEnabled}
                disabled={isToggling || agentResponsibility.readOnly}
                className="w-9 px-0"
                title={
                  agentResponsibility.readOnly
                    ? "Store-linked agentResponsibilities are read-only"
                    : `${toggleLabel} agentResponsibility`
                }
                aria-label={`${toggleLabel} agentResponsibility`}
              >
                {isToggling ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : agentResponsibility.disabled ? (
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
                title="Run agentResponsibility now"
                aria-label="Run agentResponsibility now"
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
                disabled={agentResponsibility.readOnly}
                className="w-9 px-0"
                title={
                  agentResponsibility.readOnly
                    ? "Store-linked agentResponsibilities are read-only"
                    : "Edit agentResponsibility"
                }
                aria-label="Edit agentResponsibility"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onDelete}
                className="w-9 px-0 text-red-400"
                title={
                  agentResponsibility.source === "store"
                    ? "Remove Store agentResponsibility from this repo"
                    : "Delete agentResponsibility"
                }
                aria-label={
                  agentResponsibility.source === "store"
                    ? "Remove Store agentResponsibility from this repo"
                    : "Delete agentResponsibility"
                }
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </header>

          {/* Description card inside the hero when present */}
          {hasBody ? (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 md:p-5">
              <MarkdownPreview
                content={agentResponsibility.body}
                variant="compact"
              />
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
                describe the agentResponsibility&apos;s purpose, allowed
                commands, and restrictions.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={onEdit}
              disabled={agentResponsibility.readOnly}
              className="gap-1.5 mt-1"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit agentResponsibility
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function CreateAgentResponsibilityDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (agentResponsibility: AgentResponsibility) => void;
}) {
  const { githubUser } = useGitHubIdentity();
  const createMutation = useCreateAgentResponsibility(githubUser?.login);
  const initialValues = useMemo(
    () => buildNewAgentResponsibilityFormValues(),
    [],
  );

  const handleSubmit = (values: AgentResponsibilityFormSubmitValues) => {
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
        agentAction: values.agentAction,
      },
      {
        onSuccess: (agentResponsibility) => onCreated(agentResponsibility),
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
          <DialogTitle>New agentResponsibility</DialogTitle>
          <DialogDescription>
            Describe the agentResponsibility&apos;s purpose, allowed commands,
            and restrictions.
          </DialogDescription>
        </DialogHeader>

        <AgentResponsibilityForm
          key={open ? "open" : "closed"}
          initialValues={initialValues}
          titleId="agentResponsibility-title"
          actionId="agentResponsibility-action"
          simpleCreate
          autoBuildBody
          isPending={createMutation.isPending}
          submitLabel="Create agentResponsibility"
          pendingLabel="Creating…"
          onCancel={onClose}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function EditAgentResponsibilityDialog({
  agentResponsibility,
  onClose,
  onSaved,
}: {
  agentResponsibility: AgentResponsibility;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { githubUser } = useGitHubIdentity();
  const updateMutation = useUpdateAgentResponsibility(
    agentResponsibility.slug,
    githubUser?.login,
  );
  const initialValues = useMemo(
    () => buildAgentResponsibilityFormValues(agentResponsibility),
    [agentResponsibility],
  );

  const handleSubmit = (values: AgentResponsibilityFormSubmitValues) => {
    if (updateMutation.isPending) return;
    const patch: {
      title?: string;
      body?: string;
      schedule?: ScheduleEvery | null;
      capabilityKind?: AgentResponsibilityCapabilityKind | null;
      agent?: string | null;
      reviewer?: string | null;
      action?: string | null;
      agentAction?: string | null;
    } = {};
    if (values.title !== agentResponsibility.title) patch.title = values.title;
    if (values.body !== agentResponsibility.body) patch.body = values.body;
    if (values.schedule !== agentResponsibility.schedule)
      patch.schedule = values.schedule;
    if (values.capabilityKind !== agentResponsibility.capabilityKind) {
      patch.capabilityKind = values.capabilityKind;
    }
    if (values.agent !== agentResponsibility.agent) patch.agent = values.agent;
    if (values.reviewer !== agentResponsibility.reviewer)
      patch.reviewer = values.reviewer;
    if (values.action !== agentResponsibility.action)
      patch.action = values.action;
    if (values.agentAction !== agentResponsibility.agentAction)
      patch.agentAction = values.agentAction;
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
          <DialogTitle>
            Edit agentResponsibility `{agentResponsibility.slug}`
          </DialogTitle>
          <DialogDescription>
            Update the agentResponsibility&apos;s metadata, agentAction
            assignment, or body. Saving commits the file to the default branch.
          </DialogDescription>
        </DialogHeader>

        <AgentResponsibilityForm
          initialValues={initialValues}
          titleId="edit-agentResponsibility-title"
          actionId="edit-agentResponsibility-action"
          isPending={updateMutation.isPending}
          submitLabel="Save changes"
          pendingLabel="Saving…"
          onCancel={onClose}
          onSubmit={handleSubmit}
          timing={
            <AgentResponsibilityTimingReadout
              lastTickAt={agentResponsibility.lastTickAt}
            />
          }
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Inline "last run" pill for use in the agentResponsibility-list rows. Hidden when
 * no run proof is visible — keeps the row dense. Refreshes every 30s.
 * Source is the agentResponsibility state file or the newer activity log fallback.
 */
function AgentResponsibilityStatusToggle({
  value,
  onChange,
}: {
  value: AgentResponsibilityStatusFilterValue;
  onChange: (next: AgentResponsibilityStatusFilterValue) => void;
}) {
  const options: Array<{
    label: string;
    value: AgentResponsibilityStatusFilterValue;
  }> = [
    { label: "Enabled", value: ENABLED_STATUS_FILTER },
    { label: "Disabled", value: DISABLED_STATUS_FILTER },
  ];
  return (
    <div
      className="grid h-9 grid-cols-2 gap-0.5 rounded-md border border-border bg-background/40 p-0.5"
      role="group"
      aria-label="Filter agentResponsibilities by status"
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
function AgentResponsibilityAgentFilter({
  value,
  onChange,
  agentSlugs,
  staffTitleBySlug,
  hasAgentResponsibilitiesWithoutAgent,
}: {
  value: string;
  onChange: (next: string) => void;
  agentSlugs: string[];
  staffTitleBySlug: Map<string, string>;
  hasAgentResponsibilitiesWithoutAgent: boolean;
}) {
  const options: SearchableSelectOption[] = [
    { value: ALL_AGENT_FILTER, label: "All agent" },
    ...(hasAgentResponsibilitiesWithoutAgent
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
  value: AgentResponsibilityCapabilityKind;
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

function buildAgentResponsibilityBodyForCapabilityKind(
  capabilityKind: AgentResponsibilityCapabilityKind | null,
): string {
  if (capabilityKind === "act") {
    return `## Job\n\nPerform one requested change or trigger one operation.\n\n## Allowed Commands\n\n- Run the selected agentAction.\n\n## Restrictions\n\n- Do not decide whether a larger goal is complete.\n- Return factual evidence only.\n`;
  }

  if (capabilityKind === "verify") {
    return `## Job\n\nConfirm whether one specific claim passed or failed.\n\n## Allowed Commands\n\n- Inspect the relevant files, GitHub state, logs, reports, or preview.\n\n## Restrictions\n\n- Do not fix failures from this agentResponsibility.\n- Return blockers and evidence when verification fails.\n`;
  }

  return `## Job\n\nInspect the target and report what is true.\n\n## Allowed Commands\n\n- Read relevant files, GitHub state, logs, reports, or runtime output.\n\n## Restrictions\n\n- Do not make changes or dispatch repairs.\n- Keep findings factual and evidence-based.\n`;
}

interface AgentResponsibilityFormValues {
  title: string;
  body: string;
  schedule: ScheduleEvery | null;
  capabilityKind: AgentResponsibilityCapabilityKind | null;
  agent: string | null;
  reviewer: string | null;
  action: string;
  agentAction: string | null;
}

interface AgentResponsibilityFormSubmitValues {
  title: string;
  body: string;
  schedule: ScheduleEvery | null;
  capabilityKind: AgentResponsibilityCapabilityKind | null;
  agent: string | null;
  reviewer: string | null;
  action: string | null;
  agentAction: string | null;
}

function buildNewAgentResponsibilityFormValues(): AgentResponsibilityFormValues {
  const capabilityKind: AgentResponsibilityCapabilityKind = "observe";
  return {
    title: "",
    body: buildAgentResponsibilityBodyForCapabilityKind(capabilityKind),
    schedule: null,
    capabilityKind,
    agent: null,
    reviewer: null,
    action: "",
    agentAction: null,
  };
}

function buildAgentResponsibilityFormValues(
  agentResponsibility: AgentResponsibility,
): AgentResponsibilityFormValues {
  return {
    title: agentResponsibility.title,
    body: agentResponsibility.body || "",
    schedule: agentResponsibility.schedule,
    capabilityKind: agentResponsibility.capabilityKind,
    agent: agentResponsibility.agent,
    reviewer: agentResponsibility.reviewer,
    action: agentResponsibility.action,
    agentAction: agentResponsibility.agentAction,
  };
}

function AgentResponsibilityForm({
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
  initialValues: AgentResponsibilityFormValues;
  titleId: string;
  actionId: string;
  simpleCreate?: boolean;
  autoBuildBody?: boolean;
  isPending: boolean;
  submitLabel: string;
  pendingLabel: string;
  onCancel: () => void;
  onSubmit: (values: AgentResponsibilityFormSubmitValues) => void;
  timing?: ReactNode;
}) {
  const [title, setTitle] = useState(initialValues.title);
  const [body, setBody] = useState(initialValues.body);
  const [schedule, setSchedule] = useState<ScheduleEvery | null>(
    initialValues.schedule,
  );
  const [bodyTouched, setBodyTouched] = useState(false);
  const [capabilityKind, setCapabilityKind] =
    useState<AgentResponsibilityCapabilityKind | null>(
      initialValues.capabilityKind,
    );
  const [agent, setAgent] = useState<string | null>(initialValues.agent);
  const [reviewer, setReviewer] = useState<string | null>(
    initialValues.reviewer,
  );
  const [action, setAction] = useState(initialValues.action);
  const [actionTouched, setActionTouched] = useState(false);
  const [agentAction, setAgentAction] = useState<string | null>(
    initialValues.agentAction,
  );

  useEffect(() => {
    setTitle(initialValues.title);
    setBody(initialValues.body);
    setSchedule(initialValues.schedule);
    setBodyTouched(false);
    setCapabilityKind(initialValues.capabilityKind);
    setAgent(initialValues.agent);
    setReviewer(initialValues.reviewer);
    setAction(initialValues.action);
    setActionTouched(false);
    setAgentAction(initialValues.agentAction);
  }, [initialValues]);

  const updateTitle = (next: string) => {
    setTitle(next);
    if (!autoBuildBody) return;
    const nextAction = actionTouched ? action : slugifyAction(next);
    if (!actionTouched) setAction(nextAction);
    if (!bodyTouched) {
      setBody(buildAgentResponsibilityBodyForCapabilityKind(capabilityKind));
    }
  };

  const updateAction = (next: string) => {
    const nextAction = slugifyAction(next);
    setActionTouched(true);
    setAction(nextAction);
  };

  const updateCapabilityKind = (
    next: AgentResponsibilityCapabilityKind | null,
  ) => {
    setCapabilityKind(next);
    if (autoBuildBody && !bodyTouched) {
      setBody(buildAgentResponsibilityBodyForCapabilityKind(next));
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
      agentAction,
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
        <AgentResponsibilityCapabilityKindSelect
          value={capabilityKind}
          onChange={updateCapabilityKind}
          allowUnset={!simpleCreate}
        />
        <AgentResponsibilityActionScheduleRow
          actionId={actionId}
          action={action}
          onActionChange={updateAction}
          schedule={schedule}
          onScheduleChange={setSchedule}
          hideAction={simpleCreate}
        />
        <AgentResponsibilityAgentActionOutputRow
          agentAction={agentAction}
          onAgentActionChange={setAgentAction}
        />
        <AgentResponsibilityAgentRoleRow
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

function AgentResponsibilityActionScheduleRow({
  actionId,
  action,
  onActionChange,
  schedule,
  onScheduleChange,
  hideAction = false,
}: {
  actionId: string;
  action: string;
  onActionChange: (next: string) => void;
  schedule: ScheduleEvery | null;
  onScheduleChange: (next: ScheduleEvery | null) => void;
  hideAction?: boolean;
}) {
  return (
    <div
      className={cn("grid grid-cols-1 gap-4", !hideAction && "md:grid-cols-2")}
    >
      {hideAction ? null : (
        <div className="space-y-1.5">
          <Label htmlFor={actionId}>Action</Label>
          <Input
            id={actionId}
            value={action}
            onChange={(e) => onActionChange(e.target.value)}
            placeholder="e.g. release-notes"
          />
        </div>
      )}
      <ScheduleSelect value={schedule} onChange={onScheduleChange} />
    </div>
  );
}

function ScheduleSelect({
  value,
  onChange,
}: {
  value: ScheduleEvery | null;
  onChange: (next: ScheduleEvery | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="agentResponsibility-schedule">Schedule</Label>
      <Select
        value={value ?? "__default__"}
        onValueChange={(next) =>
          onChange(next === "__default__" ? null : (next as ScheduleEvery))
        }
      >
        <SelectTrigger id="agentResponsibility-schedule">
          <SelectValue placeholder="Every scheduler wake" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__default__">Every scheduler wake</SelectItem>
          {ALL_SCHEDULE_EVERY_OPTIONS.map((option) => (
            <SelectItem key={option} value={option}>
              {scheduleEveryLabel(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function AgentResponsibilityAgentActionOutputRow({
  agentAction,
  onAgentActionChange,
}: {
  agentAction: string | null;
  onAgentActionChange: (next: string | null) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4">
      <AgentActionSelect value={agentAction} onChange={onAgentActionChange} />
    </div>
  );
}

function AgentResponsibilityCapabilityKindSelect({
  value,
  onChange,
  allowUnset,
}: {
  value: AgentResponsibilityCapabilityKind | null;
  onChange: (next: AgentResponsibilityCapabilityKind | null) => void;
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
        aria-label="AgentResponsibility kind"
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

function AgentResponsibilityAgentRoleRow({
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
    { value: null, label: "None (agentResponsibility won't run)" },
    ...withSelectedStaffFallback(agent ?? [], value).map((w) => ({
      value: w.slug,
      label: `${w.title} (${w.slug})`,
      searchText: `${w.slug} ${w.title}`,
    })),
  ];
  return (
    <div className="space-y-1.5">
      <Label htmlFor="agentResponsibility-agent">Agent</Label>
      <SearchableSelect
        id="agentResponsibility-agent"
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
            No agent assigned. Pick one before using this in a loop or goal.
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
      <Label
        htmlFor="agent-responsibility-reviewer"
        className="flex items-center gap-1.5"
      >
        <UserCheck className="w-3.5 h-3.5 text-muted-foreground" />
        Reviewer
      </Label>
      <SearchableSelect
        id="agent-responsibility-reviewer"
        value={value}
        onChange={onChange}
        options={options}
        placeholder={isLoading ? "Loading agent…" : "Select a reviewer"}
        searchPlaceholder="Search agent…"
        emptyLabel="No agent found"
        disabled={isLoading}
      />
      <p className="text-xs text-muted-foreground">
        Agent member responsible for reviewing or handling this
        agentResponsibility&apos;s output.
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

function AgentActionSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const {
    data: agentActions = [],
    error,
    isError,
    isLoading,
  } = useAgentActionSummaries();
  const agentActionOptions =
    value && !agentActions.some((exec) => exec.slug === value)
      ? [{ slug: value }, ...agentActions]
      : agentActions;
  const options: SearchableSelectOption[] = [
    { value: null, label: "No agentAction" },
    ...agentActionOptions.map((exec) => ({
      value: exec.slug,
      label: exec.slug,
      description: exec.describe,
      searchText: `${exec.slug} ${exec.describe ?? ""}`,
    })),
  ];

  return (
    <div className="space-y-1.5">
      <Label htmlFor="agentResponsibility-agentAction">AgentAction</Label>
      <SearchableSelect
        id="agentResponsibility-agentAction"
        value={value}
        onChange={onChange}
        options={options}
        placeholder={isLoading ? "Loading agentActions…" : "Select agentAction"}
        searchPlaceholder="Search agentActions…"
        emptyLabel="No agentActions found"
        disabled={isLoading || isError}
      />
      {isError ? (
        <p className="px-1 text-xs text-rose-300">
          Failed to load agentActions: {(error as Error).message}
        </p>
      ) : null}
    </div>
  );
}

/** Read-only last-run readout shown inside the Edit dialog. Refreshes every 30s. */
function AgentResponsibilityTimingReadout({
  lastTickAt,
}: {
  lastTickAt: string | null;
}) {
  const now = useNow(30_000);
  const last = lastTickAt ? new Date(lastTickAt) : null;
  if (!last) return null;
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span
        className="inline-flex items-center gap-1"
        title={last.toLocaleString()}
      >
        <Clock className="w-3 h-3" />
        last run {formatRelativePast(last, now)}
      </span>
    </div>
  );
}
