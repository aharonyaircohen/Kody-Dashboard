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
  Search,
  XCircle,
  Clock,
} from "lucide-react";
import { Button } from "@dashboard/ui/button";
import { PageShell } from "./PageShell";
import { useAuth } from "../auth-context";
import { useActivity } from "../hooks/useActivity";
import { cn } from "../utils";
import type { ActivityRun } from "../activity/types";
import { ACTIVITY_CATEGORY_LABELS } from "../activity/categorize";

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
  const [query, setQuery] = useState("");
  const [trigger, setTrigger] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [action, setAction] = useState<string>("all");

  const triggers = useMemo(() => {
    const set = new Set<string>();
    for (const r of data?.runs ?? []) set.add(r.trigger);
    return ["all", ...[...set].sort()];
  }, [data]);

  const runs = useMemo(() => {
    let all = data?.runs ?? [];
    if (filter === "active")
      all = all.filter(
        (r) => r.status === "queued" || r.status === "in_progress",
      );
    else if (filter === "failed")
      all = all.filter(
        (r) =>
          r.status === "completed" &&
          (r.conclusion === "failure" || r.conclusion === "timed_out"),
      );
    if (trigger !== "all") all = all.filter((r) => r.trigger === trigger);
    if (category !== "all")
      all = all.filter((r) => r.category === category);
    if (action !== "all") all = all.filter((r) => r.action === action);
    const q = query.trim().toLowerCase();
    if (q)
      all = all.filter((r) =>
        [
          r.title,
          r.branch ?? "",
          r.actor ?? "",
          r.trigger,
          r.action ?? "",
          `#${r.runNumber}`,
        ]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    return all;
  }, [data, filter, trigger, category, action, query]);

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

      {s && Object.keys(s.byTrigger).length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-white/40">Triggers (last 15 min):</span>
          {Object.entries(s.byTrigger)
            .sort((a, b) => b[1] - a[1])
            .map(([ev, n]) => (
              <button
                key={ev}
                type="button"
                onClick={() => setTrigger(ev)}
                title={`Filter to ${ev}`}
                className={cn(
                  "rounded-md border px-2 py-0.5 tabular-nums transition-colors",
                  n >= 8
                    ? "border-rose-500/40 bg-rose-500/[0.08] text-rose-200"
                    : "border-white/[0.08] bg-white/[0.03] text-white/60 hover:bg-white/[0.06]",
                )}
              >
                {ev} · {n}
              </button>
            ))}
        </div>
      )}

      {s && Object.keys(s.byCategory).length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-white/40">Activity (last 15 min):</span>
          {Object.entries(s.byCategory)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, n]) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                title={`Filter to ${cat}`}
                className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 tabular-nums text-white/60 transition-colors hover:bg-white/[0.06]"
              >
                {ACTIVITY_CATEGORY_LABELS[
                  cat as keyof typeof ACTIVITY_CATEGORY_LABELS
                ] ?? cat}{" "}
                · {n}
              </button>
            ))}
        </div>
      )}

      {s && Object.keys(s.byAction).length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-white/40">Actions (last 15 min):</span>
          {Object.entries(s.byAction)
            .sort((a, b) => b[1] - a[1])
            .map(([act, n]) => (
              <button
                key={act}
                type="button"
                onClick={() => setAction(act)}
                title={`Filter to ${act}`}
                className="rounded-md border border-sky-500/25 bg-sky-500/[0.06] px-2 py-0.5 tabular-nums text-sky-200/80 transition-colors hover:bg-sky-500/15"
              >
                {act} · {n}
              </button>
            ))}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
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
        </div>

        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, branch, actor…"
            className="w-56 rounded-md border border-white/[0.08] bg-white/[0.02] py-1 pl-7 pr-2 text-xs placeholder:text-white/30 focus:border-white/20 focus:outline-none"
          />
        </div>

        <select
          value={trigger}
          onChange={(e) => setTrigger(e.target.value)}
          aria-label="Filter by trigger"
          className="rounded-md border border-white/[0.08] bg-white/[0.02] py-1 px-2 text-xs text-white/70 focus:border-white/20 focus:outline-none"
        >
          {triggers.map((t) => (
            <option key={t} value={t} className="bg-neutral-900">
              {t === "all" ? "all triggers" : t}
            </option>
          ))}
        </select>

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
          className="rounded-md border border-white/[0.08] bg-white/[0.02] py-1 px-2 text-xs text-white/70 focus:border-white/20 focus:outline-none"
        >
          <option value="all" className="bg-neutral-900">
            all categories
          </option>
          {Object.entries(ACTIVITY_CATEGORY_LABELS).map(([k, label]) => (
            <option key={k} value={k} className="bg-neutral-900">
              {label}
            </option>
          ))}
        </select>

        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          aria-label="Filter by action"
          className="rounded-md border border-white/[0.08] bg-white/[0.02] py-1 px-2 text-xs text-white/70 focus:border-white/20 focus:outline-none"
        >
          <option value="all" className="bg-neutral-900">
            all actions
          </option>
          {["fix", "sync", "resolve", "review", "run"].map((a) => (
            <option key={a} value={a} className="bg-neutral-900">
              {a}
            </option>
          ))}
        </select>

        {(query ||
          trigger !== "all" ||
          category !== "all" ||
          action !== "all" ||
          filter !== "all") && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setTrigger("all");
              setCategory("all");
              setAction("all");
              setFilter("all");
            }}
            className="text-[11px] text-white/40 hover:text-white"
          >
            Clear
          </button>
        )}

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
                  <div className="text-[10px] text-white/40 truncate">
                    <span className="rounded bg-white/[0.06] px-1 py-0.5 text-white/55">
                      {ACTIVITY_CATEGORY_LABELS[r.category] ?? r.category}
                    </span>{" "}
                    {r.action && (
                      <>
                        {" "}
                        <span className="rounded bg-sky-500/15 px-1 py-0.5 text-sky-200/80">
                          {r.action}
                        </span>
                      </>
                    )}{" "}
                    <span className="text-white/45">{r.trigger}</span>
                    {r.runNumber != null && <> · #{r.runNumber}</>}
                    {r.actor && <> · @{r.actor}</>}
                    {r.branch && <> · {r.branch}</>}
                  </div>
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
