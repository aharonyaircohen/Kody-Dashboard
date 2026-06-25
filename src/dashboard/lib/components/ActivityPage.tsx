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
import Link from "next/link";
import {
  Activity as ActivityIcon,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  XCircle,
  Clock,
  ScrollText,
  ChevronRight,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@dashboard/ui/button";
import { PageShell } from "./PageShell";
import { HealthBanner } from "./HealthBanner";
import { useAuth } from "../auth-context";
import { useActivity } from "../hooks/useActivity";
import { useActivityFeed } from "../hooks/useActivityFeed";
import { useActivityLog } from "../hooks/useActivityLog";
import { useActivityRunLogs } from "../hooks/useActivityRunLogs";
import { useAutonomousActivity } from "../hooks/useAutonomousActivity";
import { cn, formatDuration } from "../utils";
import type { ActivityRun } from "../activity/types";
import type { ActionLogEntry } from "../activity/action-log";
import type {
  KodyRunLogsRun,
  KodyRunTimelineItem,
} from "../activity/run-logs";
import type {
  FeedEvent,
  FeedSession,
  FeedSource,
  FeedOrigin,
} from "../activity/feed";
import { ACTIVITY_CATEGORY_LABELS } from "../activity/categorize";

type RunFilter = "all" | "active" | "failed";
type ActivityTab = "log" | "auto" | "runs" | "runLogs" | "feed";

const FEED_SOURCE_STYLES: Record<FeedSource, string> = {
  engine: "bg-sky-500/15 text-sky-200/80",
  chat: "bg-violet-500/15 text-violet-200/80",
  pipeline: "bg-emerald-500/15 text-emerald-200/80",
  other: "bg-white/[0.06] text-white/55",
};

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
  return <span className="text-white/45">{run.conclusion ?? "completed"}</span>;
}

const FEED_ORIGIN_STYLES: Record<FeedOrigin, string> = {
  live: "bg-sky-500/15 text-sky-200/80",
  vibe: "bg-violet-500/15 text-violet-200/80",
  direct: "bg-emerald-500/15 text-emerald-200/80",
  test: "bg-white/[0.06] text-white/55",
  other: "bg-white/[0.06] text-white/55",
};

function fmtExactTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      title="Copy raw JSON"
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white/40 hover:text-white hover:bg-white/[0.06]"
    >
      {done ? (
        <Check className="w-3 h-3 text-emerald-300" />
      ) : (
        <Copy className="w-3 h-3" />
      )}
      {done ? "copied" : "copy"}
    </button>
  );
}

function EventItem({ ev }: { ev: FeedEvent }) {
  const [open, setOpen] = useState(false);
  const raw = JSON.stringify({ event: ev.kind, ...ev.payload }, null, 2);
  return (
    <li className="rounded-md border border-white/[0.05] bg-white/[0.015]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left hover:bg-white/[0.03]"
      >
        <ChevronRight
          className={cn(
            "mt-0.5 w-3 h-3 shrink-0 text-white/35 transition-transform",
            open && "rotate-90",
          )}
        />
        <span
          className={cn(
            "mt-px shrink-0 rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide",
            FEED_SOURCE_STYLES[ev.source],
          )}
        >
          {ev.source}
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-xs">{ev.summary}</span>
          <span className="block text-[10px] text-white/35">
            <span className="font-mono text-white/50">{ev.kind}</span>
            {ev.step && <> · {ev.step}</>}
            {ev.status && <> · {ev.status}</>}
          </span>
        </span>
        <span
          className="shrink-0 text-[10px] text-white/35 tabular-nums"
          title={fmtExactTime(ev.emittedAt)}
        >
          {relTime(ev.emittedAt)}
        </span>
      </button>
      {open && (
        <div className="border-t border-white/[0.05] px-2.5 py-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] text-white/40">
              {fmtExactTime(ev.emittedAt)}
              {ev.runId && <> · run {ev.runId}</>}
              {ev.channel && <> · {ev.channel}</>}
            </span>
            <CopyButton text={raw} />
          </div>
          <pre className="max-h-72 overflow-auto rounded bg-black/30 p-2 text-[10px] leading-relaxed text-white/70">
            {raw}
          </pre>
        </div>
      )}
    </li>
  );
}

function StatusPill({ s }: { s: FeedSession["status"] }) {
  const map = {
    running: "text-sky-300",
    exited: "text-white/45",
    error: "text-rose-300",
    unknown: "text-white/35",
  } as const;
  return (
    <span className={cn("inline-flex items-center gap-1", map[s])}>
      {s === "running" ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : s === "error" ? (
        <XCircle className="w-3 h-3" />
      ) : (
        <CheckCircle2 className="w-3 h-3" />
      )}
      {s}
    </span>
  );
}

function SessionCard({ s }: { s: FeedSession }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg border border-white/[0.06] bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-white/[0.04]"
      >
        <ChevronRight
          className={cn(
            "mt-0.5 w-3.5 h-3.5 shrink-0 text-white/35 transition-transform",
            open && "rotate-90",
          )}
        />
        <span
          className={cn(
            "mt-px shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            FEED_ORIGIN_STYLES[s.origin],
          )}
        >
          {s.origin}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-white/90 line-clamp-2">{s.title}</div>
          {s.description && (
            <div className="mt-0.5 text-[11px] text-white/45 line-clamp-2">
              {s.description}
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-white/40">
            <StatusPill s={s.status} />
            {s.startedAt && (
              <span
                className="tabular-nums text-white/55"
                title={`started ${fmtExactTime(s.startedAt)}`}
              >
                {fmtExactTime(s.startedAt)}
              </span>
            )}
            {s.issueNumber != null && (
              <Link
                href={`/${s.issueNumber}`}
                onClick={(e) => e.stopPropagation()}
                className="text-sky-300/80 hover:underline hover:text-sky-200"
                title={`Open task #${s.issueNumber} in the dashboard`}
              >
                issue #{s.issueNumber}
              </Link>
            )}
            {s.repo && <span>target {s.repo}</span>}
            {s.runUrl && (
              <a
                href={s.runUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title="Open the GitHub Actions run that executed this session"
                className="inline-flex items-center gap-1 hover:text-white"
              >
                executor: run {s.runId ?? ""}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {s.initiator && <span>by {s.initiator}</span>}
            {s.turns != null && <span>{s.turns} turn(s)</span>}
            {s.exitReason && <span>{s.exitReason}</span>}
            <span>{s.eventCount} event(s)</span>
            <span className="font-mono text-white/30">{s.sessionId}</span>
          </div>
        </div>
        <div
          className="shrink-0 text-right text-[11px] text-white/40 tabular-nums"
          title={s.startedAt ? fmtExactTime(s.startedAt) : ""}
        >
          {s.startedAt ? relTime(s.startedAt) : "—"}
        </div>
      </button>
      {open && (
        <div className="border-t border-white/[0.06] px-3 py-2">
          <div className="mb-2 text-[10px] text-white/40">
            started {s.startedAt ? fmtExactTime(s.startedAt) : "—"}
            {s.endedAt && <> · ended {fmtExactTime(s.endedAt)}</>}
            {s.runId && <> · run {s.runId}</>}
          </div>
          <ul className="space-y-1">
            {s.events.map((ev) => (
              <EventItem key={ev.id} ev={ev} />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

function timelineTone(item: KodyRunTimelineItem): string {
  if (item.category === "failure") return "bg-rose-500/15 text-rose-200/90";
  if (item.category === "stage") return "bg-sky-500/15 text-sky-200/85";
  if (item.category === "preflight")
    return "bg-amber-500/15 text-amber-200/85";
  if (item.category === "postflight")
    return "bg-emerald-500/15 text-emerald-200/85";
  return "bg-white/[0.06] text-white/65";
}

function fmtMs(ms: number | null): string | null {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  return formatDuration(ms / 1000);
}

function RunTimelineItem({ item }: { item: KodyRunTimelineItem }) {
  const duration = fmtMs(item.durationMs);
  return (
    <li className="flex items-start gap-2 text-xs">
      <span
        className={cn(
          "mt-0.5 rounded px-1.5 py-0.5 text-[10px] uppercase",
          timelineTone(item),
        )}
      >
        {item.category}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-white/80">{item.summary}</span>
          {duration && (
            <span className="text-[10px] tabular-nums text-white/35">
              {duration}
            </span>
          )}
          {item.outcome && (
            <span className="text-[10px] text-white/35">{item.outcome}</span>
          )}
        </div>
        {(item.detail || item.exitCode != null) && (
          <div className="mt-0.5 text-[11px] text-white/45">
            {item.detail}
            {item.detail && item.exitCode != null ? " · " : ""}
            {item.exitCode != null ? `exit ${item.exitCode}` : ""}
          </div>
        )}
      </div>
      {item.ts && (
        <span className="shrink-0 text-[10px] text-white/35">
          {new Date(item.ts).toLocaleTimeString()}
        </span>
      )}
    </li>
  );
}

function RunLogCard({ run }: { run: KodyRunLogsRun }) {
  const isAvailable = run.artifactStatus === "available";
  return (
    <li className="rounded-lg border border-white/[0.06] bg-white/[0.02]">
      <div className="flex flex-wrap items-start gap-3 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-white/85">{run.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-white/40">
            <span>run {run.runId}</span>
            {run.runNumber != null && <span>#{run.runNumber}</span>}
            <span>attempt {run.runAttempt}</span>
            <span>{relTime(run.createdAt)}</span>
          </div>
        </div>
        <span
          className={cn(
            "rounded px-2 py-0.5 text-[11px]",
            isAvailable
              ? "bg-emerald-500/15 text-emerald-200/85"
              : run.artifactStatus === "error"
                ? "bg-rose-500/15 text-rose-200/85"
                : "bg-white/[0.06] text-white/50",
          )}
        >
          {isAvailable ? `${run.timeline.length} events` : run.artifactStatus}
        </span>
        <a
          href={run.htmlUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-sky-200/70 hover:text-sky-100"
        >
          Actions <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <div className="border-t border-white/[0.06] px-3 py-2.5">
        {!isAvailable ? (
          <p className="text-xs text-white/45">
            {run.message ??
              "Run log artifact is unavailable. Open the workflow run for logs."}
          </p>
        ) : run.timeline.length === 0 ? (
          <p className="text-xs text-white/45">
            Artifact found, but no timeline events matched.
          </p>
        ) : (
          <ul className="space-y-2">
            {run.timeline.map((item) => (
              <RunTimelineItem key={item.id} item={item} />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function RunLogsView({ active }: { active: boolean }) {
  const { data, isLoading, error } = useActivityRunLogs(active);

  return (
    <div>
      {error && (
        <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/[0.06] p-3 text-xs text-rose-200">
          {error instanceof Error ? error.message : "Failed to load run logs"}
        </div>
      )}

      <div className="mb-3 grid grid-cols-3 gap-3">
        <StatCard label="Runs" value={data?.total ?? "—"} />
        <StatCard label="Artifacts" value={data?.available ?? "—"} tone="good" />
        <StatCard label="Fallbacks" value={data?.missing ?? "—"} />
      </div>

      {isLoading ? (
        <p className="py-6 text-center text-xs italic text-white/40">
          <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
          Loading run logs…
        </p>
      ) : !data || data.runs.length === 0 ? (
        <p className="py-6 text-center text-xs italic text-white/40">
          No workflow runs found.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {data.runs.map((run) => (
            <RunLogCard key={`${run.runId}:${run.runAttempt}`} run={run} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedView({ active }: { active: boolean }) {
  const { data, isLoading, error } = useActivityFeed(active);
  const [origin, setOrigin] = useState<"all" | FeedOrigin>("all");
  const [query, setQuery] = useState("");

  const sessions = useMemo(() => {
    let all = data?.sessions ?? [];
    if (origin !== "all") all = all.filter((s) => s.origin === origin);
    const q = query.trim().toLowerCase();
    if (q)
      all = all.filter((s) =>
        [
          s.title,
          s.description ?? "",
          s.sessionId,
          s.origin,
          s.repo ?? "",
          s.initiator ?? "",
          s.exitReason ?? "",
          s.issueNumber != null ? `#${s.issueNumber}` : "",
          ...s.events.map((e) => e.summary),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    return all;
  }, [data, origin, query]);

  return (
    <div className="mt-2">
      {error && (
        <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/[0.06] p-3 text-xs text-rose-200">
          {error instanceof Error ? error.message : "Failed to load feed"}
        </div>
      )}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          {(["all", "live", "vibe", "direct", "test", "other"] as const).map(
            (ov) => (
              <button
                key={ov}
                type="button"
                onClick={() => setOrigin(ov)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs capitalize transition-colors",
                  origin === ov
                    ? "bg-white/[0.08] text-white"
                    : "text-white/50 hover:text-white hover:bg-white/[0.04]",
                )}
              >
                {ov}
              </button>
            ),
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions, initiator, content…"
            className="w-64 rounded-md border border-white/[0.08] bg-white/[0.02] py-1 pl-7 pr-2 text-xs placeholder:text-white/30 focus:border-white/20 focus:outline-none"
          />
        </div>
        <span className="ml-auto text-[10px] text-white/35">
          {data
            ? `${sessions.length} of ${data.totalSessions} sessions · ${data.totalEvents} events`
            : ""}
          {data?.computedAt && ` · updated ${relTime(data.computedAt)}`}
        </span>
      </div>
      {isLoading ? (
        <p className="text-xs text-white/40 italic py-6 text-center">
          Loading sessions…
        </p>
      ) : sessions.length === 0 ? (
        <p className="text-xs text-white/40 italic py-6 text-center">
          No sessions in this view.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {sessions.map((s) => (
            <SessionCard key={s.sessionId} s={s} />
          ))}
        </ul>
      )}
      <p className="mt-6 text-[10px] text-white/30">
        One row per chat/run session, grouped from the engine&apos;s per-session
        event files in the state repo (events/*.jsonl). Expand a session for its events;
        expand an event for the exact time and raw payload (copyable). Loads
        only when this tab is open (60s server cache, recent sessions only),
        never polled — no steady-state GitHub API budget.
      </p>
    </div>
  );
}

function autoTriggerBadge(trigger: "schedule" | "manual" | "event"): string {
  if (trigger === "schedule") return "bg-sky-500/15 text-sky-200/80";
  if (trigger === "manual") return "bg-amber-500/15 text-amber-200/80";
  return "bg-white/[0.06] text-white/60";
}

/**
 * "Auto" tab — the Company Activity feed: named, attributed actions the
 * engine performed (an agent ran a agentResponsibility, why, and the result), written
 * by the engine to `activity/*.jsonl` in the configured Kody state repo. NOT derived from commits/PRs —
 * those carry no agent/agentResponsibility/purpose.
 */
function AutoView({ active }: { active: boolean }) {
  const { data, isLoading, error } = useAutonomousActivity(active);
  const [query, setQuery] = useState("");
  const [onlyFailed, setOnlyFailed] = useState(false);

  const records = useMemo(() => {
    let all = data?.records ?? [];
    if (onlyFailed) all = all.filter((r) => r.outcome === "failed");
    const q = query.trim().toLowerCase();
    if (q)
      all = all.filter((r) =>
        [r.action, r.agent ?? "", r.staffTitle ?? "", r.agentResponsibility, r.trigger]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    return all;
  }, [data, query, onlyFailed]);

  return (
    <div className="mt-2">
      {error && (
        <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/[0.06] p-3 text-xs text-rose-200">
          {error instanceof Error ? error.message : "Failed to load"}
        </div>
      )}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOnlyFailed((v) => !v)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs transition-colors",
            onlyFailed
              ? "bg-rose-500/15 text-rose-200"
              : "text-white/50 hover:text-white hover:bg-white/[0.04]",
          )}
        >
          Failed only
        </button>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search action, agent, agentResponsibility…"
            className="w-64 rounded-md border border-white/[0.08] bg-white/[0.02] py-1 pl-7 pr-2 text-xs placeholder:text-white/30 focus:border-white/20 focus:outline-none"
          />
        </div>
        <span className="ml-auto text-[10px] text-white/35">
          {data ? `${records.length} actions` : ""}
          {data?.computedAt && ` · updated ${relTime(data.computedAt)}`}
        </span>
      </div>
      {isLoading ? (
        <p className="text-xs text-white/40 italic py-6 text-center">
          Loading company activity…
        </p>
      ) : records.length === 0 ? (
        <p className="text-xs text-white/40 italic py-6 text-center">
          No autonomous activity yet — appears once a agentResponsibility runs on the updated
          engine.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {records.map((r, i) => (
            <li
              key={`${r.ts}-${r.agentResponsibility}-${i}`}
              className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
            >
              <span className="mt-0.5 shrink-0">
                {r.outcome === "failed" ? (
                  <XCircle className="w-4 h-4 text-rose-400" />
                ) : r.outcome === "completed" ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Clock className="w-4 h-4 text-white/40" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate text-white/85">{r.action}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] text-white/40">
                  {r.staffTitle || r.agent ? (
                    <span className="rounded bg-emerald-500/15 px-1 text-emerald-200/80">
                      {r.staffTitle ?? r.agent}
                    </span>
                  ) : null}
                  <span className="rounded bg-violet-500/15 px-1 text-violet-200/80">
                    agentResponsibility: {r.agentResponsibility}
                  </span>
                  <span
                    className={cn("rounded px-1", autoTriggerBadge(r.trigger))}
                  >
                    {r.trigger}
                  </span>
                  {typeof r.durationMs === "number" && r.durationMs > 0 ? (
                    <span>· {formatDuration(r.durationMs)}</span>
                  ) : null}
                  {r.runUrl ? (
                    <a
                      href={r.runUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 text-sky-300/70 hover:underline"
                    >
                      run <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  ) : null}
                </div>
              </div>
              <div
                className="shrink-0 text-right text-[11px] text-white/40 tabular-nums"
                title={fmtExactTime(r.ts)}
              >
                {fmtExactTime(r.ts)}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-[10px] text-white/30">
        Company activity — each line is one action the engine took: which agent
        member ran which agentResponsibility, why (schedule / manual), and the result. Written
        by the engine; the Log tab shows dashboard actions instead.
      </p>
    </div>
  );
}

function LogView({ active }: { active: boolean }) {
  const { data, isLoading, error } = useActivityLog(active);
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  const allEntries: ActionLogEntry[] = useMemo(
    () => data?.entries ?? [],
    [data],
  );

  // Distinct action verbs present, for the filter dropdown.
  const actionTypes = useMemo(
    () => [...new Set(allEntries.map((e) => e.type))].sort(),
    [allEntries],
  );

  const entries = useMemo(() => {
    let all = allEntries;
    if (actionFilter) all = all.filter((e) => e.type === actionFilter);
    const q = query.trim().toLowerCase();
    if (q)
      all = all.filter((e) =>
        [
          e.type,
          e.target,
          e.actor,
          e.repo ?? "",
          e.detail ?? "",
          e.agentResponsibility ?? "",
          e.agent ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    return all;
  }, [allEntries, query, actionFilter]);

  return (
    <div className="mt-2">
      {error && (
        <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/[0.06] p-3 text-xs text-rose-200">
          {error instanceof Error ? error.message : "Failed to load log"}
        </div>
      )}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search actions, target, actor, agentResponsibility…"
            className="w-64 rounded-md border border-white/[0.08] bg-white/[0.02] py-1 pl-7 pr-2 text-xs placeholder:text-white/30 focus:border-white/20 focus:outline-none"
          />
        </div>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="rounded-md border border-white/[0.08] bg-white/[0.02] py-1 px-2 text-xs text-white/70 focus:border-white/20 focus:outline-none"
        >
          <option value="">All actions</option>
          {actionTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <span className="ml-auto text-[10px] text-white/35">
          {data ? `${entries.length} of ${data.total} actions` : ""}
          {data?.computedAt && ` · updated ${relTime(data.computedAt)}`}
        </span>
      </div>
      {isLoading ? (
        <p className="text-xs text-white/40 italic py-6 text-center">
          Loading actions…
        </p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-white/40 italic py-6 text-center">
          No dashboard actions recorded yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
            >
              <span
                className={cn(
                  "mt-px shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                  e.outcome === "error"
                    ? "bg-rose-500/15 text-rose-200/80"
                    : e.outcome === "denied"
                      ? "bg-amber-500/15 text-amber-200/80"
                      : "bg-sky-500/15 text-sky-200/80",
                )}
              >
                {e.type}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate">
                  {e.resourceUrl ? (
                    <a
                      href={e.resourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-sky-300/80 hover:underline"
                    >
                      {e.target}
                    </a>
                  ) : (
                    <span className="font-mono text-white/80">{e.target}</span>
                  )}
                  {e.detail && (
                    <span className="text-white/50"> — {e.detail}</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-1.5 text-[10px] text-white/40 truncate">
                  <span>by {e.actor}</span>
                  {e.agentResponsibility && (
                    <span className="rounded bg-violet-500/15 px-1 text-violet-200/80">
                      agentResponsibility: {e.agentResponsibility}
                    </span>
                  )}
                  {e.agent && (
                    <span className="rounded bg-emerald-500/15 px-1 text-emerald-200/80">
                      agent: {e.agent}
                    </span>
                  )}
                  {e.repo && <span>· {e.repo}</span>}
                </div>
              </div>
              <div
                className="shrink-0 text-right text-[11px] text-white/40 tabular-nums"
                title={fmtExactTime(e.at)}
              >
                {fmtExactTime(e.at)}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-[10px] text-white/30">
        Dashboard actions (agentResponsibility runs/edits, task actions, vault writes,
        agent/prompt/goal changes) attributed to the verified GitHub user who
        made them. Persisted durably in the repo&apos;s audit-log issue (newest{" "}
        {150} kept) and merged with this instance&apos;s in-memory ring —
        survives redeploys and is shared across instances.
      </p>
    </div>
  );
}

export function ActivityPage() {
  const { auth } = useAuth();
  const { data, isLoading, error, refetch, isFetching } = useActivity();
  const [tab, setTab] = useState<ActivityTab>("log");
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
    if (category !== "all") all = all.filter((r) => r.category === category);
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

      <HealthBanner />

      <div className="mb-4 flex items-center gap-1">
        {(["log", "auto", "runs", "runLogs", "feed"] as ActivityTab[]).map(
          (t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              tab === t
                ? "bg-white/[0.08] text-white"
                : "text-white/50 hover:text-white hover:bg-white/[0.04]",
            )}
          >
            {t === "runs" ? (
              <ActivityIcon className="w-3.5 h-3.5" />
            ) : t === "auto" ? (
              <Bot className="w-3.5 h-3.5" />
            ) : t === "runLogs" ? (
              <Clock className="w-3.5 h-3.5" />
            ) : (
              <ScrollText className="w-3.5 h-3.5" />
            )}
            {t === "log"
              ? "Log"
              : t === "auto"
                ? "Auto"
                : t === "runs"
                  ? "Runs"
                  : t === "runLogs"
                    ? "Run Logs"
                  : "Feed"}
          </button>
          ),
        )}
      </div>

      {tab === "log" && <LogView active={tab === "log"} />}

      {tab === "auto" && <AutoView active={tab === "auto"} />}

      {tab === "runLogs" && <RunLogsView active={tab === "runLogs"} />}

      {tab === "feed" && <FeedView active={tab === "feed"} />}

      {tab === "runs" && alert && (
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

      {tab === "runs" && (
        <>
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
              hint={
                s?.noiseLast15m
                  ? `real runs · +${s.noiseLast15m} skipped/cancelled`
                  : "real runs created"
              }
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
                      <div className="text-sm truncate">
                        {r.taskNumber != null ? (
                          <Link
                            href={`/${r.taskNumber}`}
                            title={`Open task #${r.taskNumber} in the dashboard`}
                            className="hover:underline hover:text-white"
                          >
                            {r.title}
                          </Link>
                        ) : (
                          r.title
                        )}
                      </div>
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
        </>
      )}
    </PageShell>
  );
}
