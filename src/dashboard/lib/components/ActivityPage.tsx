"use client";
/**
 * @fileType component
 * @domain kody
 * @pattern activity-page
 * @ai-summary Engine Activity: one read-only screen answering "did it run,
 *   is it jammed, is something looping?" for the connected repo. Alert
 *   banner + signal cards + a filterable recent-runs list, polled every
 *   30s off the shared cached workflow-run data.
 */
import { useMemo, useState } from "react";
import {
  Activity as ActivityIcon,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  XCircle,
  Clock,
} from "lucide-react";
import { Button } from "@dashboard/ui/button";
import { PageShell } from "./PageShell";
import { useAuth } from "../auth-context";
import { useActivity } from "../hooks/useActivity";
import { cn } from "../utils";
import type { ActivityRun } from "../activity/types";

type RunFilter = "all" | "active" | "failed";

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${sec % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

function StatCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string | number;
  tone?: "default" | "warn" | "critical" | "good";
  hint?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3",
        tone === "critical"
          ? "border-rose-500/40 bg-rose-500/[0.07]"
          : tone === "warn"
            ? "border-amber-500/40 bg-amber-500/[0.07]"
            : tone === "good"
              ? "border-emerald-500/30 bg-emerald-500/[0.05]"
              : "border-white/[0.08] bg-white/[0.02]",
      )}
    >
      <div className="text-[10px] uppercase tracking-wider text-white/45">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-white/40">{hint}</div>}
    </div>
  );
}

function StatusBadge({ run }: { run: ActivityRun }) {
  if (run.status === "queued")
    return (
      <span className="inline-flex items-center gap-1 text-amber-300">
        <Clock className="w-3.5 h-3.5" /> queued
      </span>
    );
  if (run.status === "in_progress")
    return (
      <span className="inline-flex items-center gap-1 text-sky-300">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> running
      </span>
    );
  if (run.conclusion === "success")
    return (
      <span className="inline-flex items-center gap-1 text-emerald-300">
        <CheckCircle2 className="w-3.5 h-3.5" /> success
      </span>
    );
  if (run.conclusion === "failure" || run.conclusion === "timed_out")
    return (
      <span className="inline-flex items-center gap-1 text-rose-300">
        <XCircle className="w-3.5 h-3.5" /> {run.conclusion}
      </span>
    );
  return (
    <span className="text-white/45">{run.conclusion ?? "completed"}</span>
  );
}

export function ActivityPage() {
  const { auth } = useAuth();
  const { data, isLoading, error, refetch, isFetching } = useActivity();
  const [filter, setFilter] = useState<RunFilter>("all");

  const runs = useMemo(() => {
    const all = data?.runs ?? [];
    if (filter === "active")
      return all.filter(
        (r) => r.status === "queued" || r.status === "in_progress",
      );
    if (filter === "failed")
      return all.filter(
        (r) =>
          r.status === "completed" &&
          (r.conclusion === "failure" || r.conclusion === "timed_out"),
      );
    return all;
  }, [data, filter]);

  const s = data?.signals;
  const alert = data?.alert;

  return (
    <PageShell
      title="Activity"
      icon={ActivityIcon}
      iconClassName="text-sky-300"
      subtitle={auth ? `${auth.owner}/${auth.repo} · engine runs` : undefined}
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
          aria-label="Refresh activity"
        >
          {isFetching ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
        </Button>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/[0.06] p-3 text-xs text-rose-200">
          {error instanceof Error ? error.message : "Failed to load activity"}
        </div>
      )}

      {alert && (
        <div
          className={cn(
            "mb-4 flex items-start gap-2 rounded-lg border p-3 text-sm",
            alert.level === "critical"
              ? "border-rose-500/40 bg-rose-500/[0.08] text-rose-100"
              : alert.level === "warn"
                ? "border-amber-500/40 bg-amber-500/[0.08] text-amber-100"
                : "border-emerald-500/30 bg-emerald-500/[0.05] text-emerald-100",
          )}
        >
          {alert.level === "ok" ? (
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          )}
          <span>{alert.message}</span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          label="Queue depth"
          value={s?.queueDepth ?? "—"}
          tone={
            (s?.queueDepth ?? 0) >= 15
              ? "critical"
              : (s?.queueDepth ?? 0) >= 5
                ? "warn"
                : "default"
          }
          hint="queued + running"
        />
        <StatCard
          label="Last 15 min"
          value={s?.runsLast15m ?? "—"}
          tone={
            (s?.runsLast15m ?? 0) >= 20
              ? "critical"
              : (s?.runsLast15m ?? 0) >= 8
                ? "warn"
                : "default"
          }
          hint="runs created"
        />
        <StatCard
          label="Succeeded"
          value={s?.succeeded ?? "—"}
          tone="good"
          hint="recent window"
        />
        <StatCard
          label="Failed"
          value={s?.failed ?? "—"}
          tone={(s?.failed ?? 0) > 0 ? "warn" : "default"}
          hint="recent window"
        />
        <StatCard
          label="Median run"
          value={
            s?.medianDurationSec != null
              ? fmtDuration(s.medianDurationSec)
              : "—"
          }
          hint="completed runs"
        />
      </div>

      <div className="mt-6 flex items-center gap-1">
        {(["all", "active", "failed"] as RunFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs capitalize transition-colors",
              filter === f
                ? "bg-white/[0.08] text-white"
                : "text-white/50 hover:text-white hover:bg-white/[0.04]",
            )}
          >
            {f === "active" ? "Queued / running" : f}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-white/35">
          {data ? `${runs.length} shown` : ""}
          {data?.computedAt && ` · updated ${relTime(data.computedAt)}`}
        </span>
      </div>

      <div className="mt-2">
        {isLoading ? (
          <p className="text-xs text-white/40 italic py-6 text-center">
            Loading engine runs…
          </p>
        ) : runs.length === 0 ? (
          <p className="text-xs text-white/40 italic py-6 text-center">
            No runs in this view.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {runs.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 hover:bg-white/[0.04]"
              >
                <div className="w-28 shrink-0 text-xs">
                  <StatusBadge run={r} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{r.title}</div>
                  {r.branch && (
                    <div className="text-[10px] text-white/40 truncate">
                      {r.branch}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-[11px] text-white/45 tabular-nums">
                  {fmtDuration(r.durationSec)}
                </div>
                <div className="shrink-0 w-20 text-right text-[11px] text-white/40">
                  {relTime(r.createdAt)}
                </div>
                <a
                  href={r.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open run on GitHub"
                  className="shrink-0 p-1 rounded text-white/40 hover:text-white hover:bg-white/[0.06]"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-6 text-[10px] text-white/30">
        Reads the same cached workflow-run data as the rest of the dashboard
        — this view adds no extra GitHub API calls. Polls every 30s.
      </p>
    </PageShell>
  );
}
