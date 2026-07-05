/**
 * @fileType component
 * @domain kody
 * @pattern agency-runs-page
 * @ai-summary Read-only AI Agency run monitor for goals, loops, and workflows.
 */
"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  RefreshCw,
  Route,
  XCircle,
} from "lucide-react";

import { Button } from "@dashboard/ui/button";
import { useAgencyRunDetail, useAgencyRuns } from "../hooks/useAgencyRuns";
import { useRepoScopedHref } from "../hooks/useRepoScopedHref";
import type {
  AgencyRunKind,
  AgencyRunStatus,
  AgencyRunSummary,
} from "../agency-runs";
import { cn } from "../utils";
import { PageShell } from "./PageShell";

const TABS: Array<{ kind: AgencyRunKind; label: string }> = [
  { kind: "goal", label: "Goals" },
  { kind: "loop", label: "Loops" },
  { kind: "workflow", label: "Workflows" },
];

function formatTime(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(value: number | null): string {
  if (value === null) return "-";
  const seconds = Math.max(0, Math.round(value / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function statusTone(status: AgencyRunStatus): string {
  if (status === "success")
    return "border-emerald-400/25 bg-emerald-400/10 text-emerald-200";
  if (status === "failed")
    return "border-rose-400/30 bg-rose-400/10 text-rose-200";
  if (status === "blocked")
    return "border-amber-400/30 bg-amber-400/10 text-amber-200";
  if (status === "running")
    return "border-sky-400/30 bg-sky-400/10 text-sky-200";
  if (status === "waiting")
    return "border-violet-400/25 bg-violet-400/10 text-violet-200";
  return "border-white/[0.1] bg-white/[0.04] text-white/55";
}

function eventSummary(event: Record<string, unknown>): {
  event: string;
  time: string;
  status: string | null;
  reason: string | null;
} {
  return {
    event: typeof event.event === "string" ? event.event : "event",
    time: typeof event.time === "string" ? event.time : "",
    status: typeof event.status === "string" ? event.status : null,
    reason:
      typeof event.reason === "string"
        ? event.reason
        : typeof event.summary === "string"
          ? event.summary
          : null,
  };
}

function StatusIcon({ status }: { status: AgencyRunStatus }) {
  if (status === "success") return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === "failed") return <XCircle className="h-3.5 w-3.5" />;
  if (status === "blocked") return <AlertTriangle className="h-3.5 w-3.5" />;
  if (status === "running")
    return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  return <Clock3 className="h-3.5 w-3.5" />;
}

function kindHref(run: AgencyRunSummary): string {
  if (run.kind === "goal")
    return `/agent-goals/${encodeURIComponent(run.targetId)}`;
  if (run.kind === "loop")
    return `/agent-loops/${encodeURIComponent(run.targetId)}`;
  return `/workflows/${encodeURIComponent(run.targetId)}`;
}

function RunRow({
  run,
  expanded,
  onToggle,
}: {
  run: AgencyRunSummary;
  expanded: boolean;
  onToggle: () => void;
}) {
  const scopedHref = useRepoScopedHref();
  const detail = useAgencyRunDetail(expanded ? run.sourcePath : null);
  const events = (detail.data?.events ?? []).slice(-4).reverse();
  return (
    <article className="border-b border-white/[0.06] last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full gap-3 px-3 py-3 text-left text-sm hover:bg-white/[0.03] md:grid-cols-[140px_minmax(0,1.4fr)_minmax(0,1fr)_140px_90px]"
      >
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
              statusTone(run.status),
            )}
          >
            <StatusIcon status={run.status} />
            {run.status}
          </span>
        </div>
          <div className="min-w-0">
          <div className="truncate font-medium text-white/85">{run.title}</div>
          <div className="mt-0.5 flex min-w-0 flex-wrap gap-2 text-xs text-white/40">
            <span>{run.origin}</span>
            {run.modelName ?? run.model ? (
              <span>{run.modelName ?? run.model}</span>
            ) : null}
            {run.kodyRunId ? (
              <span className="font-mono">{run.kodyRunId}</span>
            ) : null}
          </div>
        </div>
        <div className="min-w-0">
          <div className="truncate text-white/70">
            {run.currentStep ?? run.summary ?? "-"}
          </div>
          {run.decision ? (
            <div className="mt-0.5 truncate text-xs text-white/40">
              {run.decision}
            </div>
          ) : null}
        </div>
        <div className="text-xs text-white/50">{formatTime(run.startedAt)}</div>
        <div className="text-xs text-white/50">
          {formatDuration(run.durationMs)}
        </div>
      </button>
      {expanded ? (
        <div className="grid gap-3 border-t border-white/[0.05] bg-black/20 px-3 py-3 text-xs md:grid-cols-2">
          <div className="space-y-1">
            <div className="text-white/35">Summary</div>
            <div className="text-white/70">{run.summary ?? "No summary"}</div>
          </div>
          <div className="space-y-1">
            <div className="text-white/35">Target</div>
            <a
              href={scopedHref(kindHref(run))}
              className="inline-flex items-center gap-1 font-mono text-sky-200/80 hover:text-sky-100"
            >
              {run.targetLabel}
            </a>
          </div>
          <div className="space-y-1">
            <div className="text-white/35">Updated</div>
            <div className="text-white/70">{formatTime(run.updatedAt)}</div>
          </div>
          <div className="space-y-1">
            <div className="text-white/35">Runtime</div>
            <div className="flex flex-wrap gap-2 text-white/70">
              {run.executable ? <span>{run.executable}</span> : null}
              {run.capability ? <span>{run.capability}</span> : null}
              {run.workflow ? <span>{run.workflow}</span> : null}
              {run.agent ? <span>{run.agent}</span> : null}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-white/35">Model</div>
            <div className="text-white/70">
              {run.model ?? run.modelName ?? "Unknown"}
              {run.reasoningEffort ? (
                <span className="ml-2 text-white/35">
                  {run.reasoningEffort}
                </span>
              ) : null}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-white/35">Actor</div>
            <div className="text-white/70">{run.actor ?? "Unknown"}</div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {run.githubRunUrl ? (
              <a
                href={run.githubRunUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 items-center gap-1 rounded-md border border-white/[0.08] px-2 text-white/55 hover:bg-white/[0.05] hover:text-white"
              >
                <ExternalLink className="h-3 w-3" />
                GitHub run
              </a>
            ) : null}
            {run.logUrl ? (
              <a
                href={run.logUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 items-center gap-1 rounded-md border border-white/[0.08] px-2 text-white/55 hover:bg-white/[0.05] hover:text-white"
              >
                <ExternalLink className="h-3 w-3" />
                Kody log
              </a>
            ) : null}
            {run.statePath ? (
              <span className="font-mono text-white/35">{run.statePath}</span>
            ) : null}
          </div>
          <div className="space-y-2 md:col-span-2">
            <div className="text-white/35">Events</div>
            {detail.isFetching ? (
              <div className="text-white/45">
                <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                Loading events...
              </div>
            ) : events.length ? (
              <div className="divide-y divide-white/[0.06] overflow-hidden rounded-md border border-white/[0.06]">
                {events.map((event, index) => {
                  const summary = eventSummary(event);
                  return (
                    <div
                      key={`${summary.time}-${summary.event}-${index}`}
                      className="grid gap-2 px-2 py-2 md:grid-cols-[150px_1fr_90px]"
                    >
                      <div className="text-white/40">
                        {formatTime(summary.time)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-white/75">
                          {summary.event}
                        </div>
                        {summary.reason ? (
                          <div className="mt-0.5 truncate text-white/40">
                            {summary.reason}
                          </div>
                        ) : null}
                      </div>
                      <div className="text-white/45">
                        {summary.status ?? "-"}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : run.sourcePath ? (
              <div className="text-white/45">No events found</div>
            ) : (
              <div className="text-white/45">No source log</div>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function EmptyPanel({ label }: { label: string }) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-2 rounded-md border border-white/[0.08] bg-black/20 px-4 py-8 text-center">
      <Route className="h-7 w-7 text-white/25" />
      <div className="text-sm font-medium text-white/75">No {label} runs</div>
      <div className="max-w-sm text-xs text-white/40">
        This page only shows Kody-native runs recorded in the state repo.
      </div>
    </div>
  );
}

export function AgencyRunsPage() {
  const { data, isLoading, error, refetch, isFetching } = useAgencyRuns();
  const [selectedKind, setSelectedKind] = useState<AgencyRunKind>("loop");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(
    () => (data?.runs ?? []).filter((run) => run.kind === selectedKind),
    [data?.runs, selectedKind],
  );
  const activeTab = TABS.find((tab) => tab.kind === selectedKind) ?? TABS[0];

  return (
    <PageShell
      title="Agency Runs"
      subtitle="Kody runs for goals, loops, and workflows"
      icon={Route}
      backHref={null}
      width="full"
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="h-8 w-8 px-0"
          title="Refresh runs"
          aria-label="Refresh runs"
        >
          {isFetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      }
      contentClassName="space-y-4"
    >
      <div className="grid gap-2 md:grid-cols-3">
        {TABS.map((tab) => {
          const active = selectedKind === tab.kind;
          const count = data?.counts[tab.kind] ?? 0;
          return (
            <button
              key={tab.kind}
              type="button"
              onClick={() => {
                setSelectedKind(tab.kind);
                setExpandedId(null);
              }}
              className={cn(
                "rounded-md border px-3 py-2 text-left transition-colors",
                active
                  ? "border-emerald-400/40 bg-emerald-400/10 text-white"
                  : "border-white/[0.08] bg-black/20 text-white/55 hover:bg-white/[0.04]",
              )}
            >
              <div className="text-sm font-medium">{tab.label}</div>
              <div className="mt-1 font-mono text-2xl tabular-nums">
                {count}
              </div>
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-sm text-rose-200">
          {error instanceof Error ? error.message : "Failed to load runs"}
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-md border border-white/[0.08] bg-black/20 px-3 py-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mr-1 inline h-4 w-4 animate-spin" />
          Loading agency runs...
        </div>
      ) : filtered.length ? (
        <section className="overflow-hidden rounded-md border border-white/[0.08] bg-black/20">
          <header className="grid gap-3 border-b border-white/[0.08] px-3 py-2 text-[10px] uppercase tracking-wide text-white/35 md:grid-cols-[140px_minmax(0,1.4fr)_minmax(0,1fr)_140px_90px]">
            <div>Status</div>
            <div>{activeTab.label.slice(0, -1)}</div>
            <div>Step</div>
            <div>Started</div>
            <div>Duration</div>
          </header>
          {filtered.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              expanded={expandedId === run.id}
              onToggle={() =>
                setExpandedId((current) => (current === run.id ? null : run.id))
              }
            />
          ))}
        </section>
      ) : (
        <EmptyPanel label={activeTab.label.toLowerCase()} />
      )}
    </PageShell>
  );
}
