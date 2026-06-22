/**
 * @fileType component
 * @domain kody
 * @pattern job-ledger-view
 * @ai-summary Renders a task's job ledger — the ordered list of engine runs
 * ("jobs") recorded in the canonical TaskState comment. Each row is one run:
 * what executable/action it was, who it ran as, instant vs scheduled, its
 * outcome, when, and a link to the run. A job IS the execution unit (mint +
 * run); this list is the durable trail those runs leave behind. "Re-run" mints
 * a fresh job via the existing whole-task rerun dispatch (re-run = new job).
 */
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Zap,
  CalendarClock,
  ExternalLink,
  RotateCcw,
} from "lucide-react";
import type { KodyHistoryEntry, KodyStatus } from "@dashboard/lib/kody-state";
import { formatRelativeTime } from "@dashboard/lib/utils";

function StatusIcon({ status }: { status?: KodyStatus }) {
  switch (status) {
    case "succeeded":
      return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
    case "failed":
      return <XCircle className="w-4 h-4 text-red-400 shrink-0" />;
    case "running":
      return (
        <Loader2 className="w-4 h-4 text-blue-400 shrink-0 animate-spin" />
      );
    default:
      return <Clock className="w-4 h-4 text-white/40 shrink-0" />;
  }
}

function FlavorBadge({ entry }: { entry: KodyHistoryEntry }) {
  const scheduled = entry.flavor === "scheduled";
  const Icon = scheduled ? CalendarClock : Zap;
  const label = scheduled
    ? entry.schedule
      ? `scheduled · ${entry.schedule}`
      : "scheduled"
    : "instant";
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/60 bg-white/[0.06]"
      title={scheduled ? "Ran on a schedule (cron)" : "Ran instantly (@kody)"}
    >
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

export function TaskRunsList({
  history,
  onRerun,
  rerunPending = false,
}: {
  history: KodyHistoryEntry[] | undefined;
  onRerun?: () => void;
  rerunPending?: boolean;
}) {
  const runs = [...(history ?? [])].sort(
    (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
  );

  return (
    <div className="p-4 md:p-5 overflow-y-auto h-full bg-white/[0.03]">
      <div className="max-w-3xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white/80">
            Runs
            <span className="ml-2 text-xs font-normal text-white/40">
              {runs.length} job{runs.length === 1 ? "" : "s"}
            </span>
          </h3>
          {onRerun && (
            <button
              type="button"
              onClick={onRerun}
              disabled={rerunPending}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-white/80 bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-50 transition-colors"
              title="Run this task again (mints a fresh job)"
            >
              <RotateCcw
                className={`w-3.5 h-3.5 ${rerunPending ? "animate-spin" : ""}`}
              />
              {rerunPending ? "Starting…" : "Re-run"}
            </button>
          )}
        </div>

        {runs.length === 0 ? (
          <p className="text-sm text-white/40 py-8 text-center">
            No runs recorded yet. The engine writes a job entry here each time
            it runs on this task.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {runs.map((entry, i) => (
              <li
                key={entry.jobId ?? `${entry.timestamp}-${i}`}
                className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
              >
                <StatusIcon status={entry.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white/85 truncate">
                      {entry.executable}
                    </span>
                    {entry.action && (
                      <span className="text-xs text-white/45">
                        {entry.action}
                      </span>
                    )}
                    <FlavorBadge entry={entry} />
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 flex-wrap text-xs text-white/45">
                    <span>{formatRelativeTime(entry.timestamp)}</span>
                    {entry.agent && (
                      <span title="Ran as agentIdentity">
                        · as {entry.agent}
                      </span>
                    )}
                    {entry.note && (
                      <span className="truncate" title={entry.note}>
                        · {entry.note}
                      </span>
                    )}
                  </div>
                </div>
                {entry.runUrl && (
                  <a
                    href={entry.runUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 inline-flex items-center gap-1 text-xs text-white/50 hover:text-white/80 transition-colors"
                    title="Open this run"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
