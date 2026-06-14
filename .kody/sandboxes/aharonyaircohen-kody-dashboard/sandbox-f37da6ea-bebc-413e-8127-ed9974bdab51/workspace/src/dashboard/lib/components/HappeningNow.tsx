/**
 * @fileType component
 * @domain kody
 * @pattern dashboard-overview
 * @ai-summary The "Happening now" panel on the operations overview. Answers the
 *   one question the rest of the dashboard doesn't — *what is Kody doing this
 *   minute* — by listing every in-flight task with its current step, how long
 *   it's been quiet, and a "stuck?" flag when a step goes silent too long. It
 *   also stamps how fresh the data is ("updated 12s ago") so the numbers are
 *   trustworthy, not just present. Rides the shared task cache the overview
 *   already polls — no extra GitHub load.
 */
"use client";

import Link from "next/link";
import { CircleDot, Clock, ExternalLink, Loader2 } from "lucide-react";

import { Card } from "@dashboard/ui/card";
import { COLUMN_DEFS } from "../constants";
import { useNow } from "../hooks/useNow";
import { cn } from "../utils";
import { autoDirProps } from "../text-direction";
import type { ColumnId, KodyTask } from "../types";

// In-flight = not a terminal/parked lane. These are the tasks "in motion".
const IN_FLIGHT_COLUMNS: readonly ColumnId[] = [
  "building",
  "retrying",
  "gate-waiting",
  "review",
];

// A step is "stuck?" when its last activity is older than this while still
// in flight. Kody stages run in minutes, so ~20m of silence is suspicious.
const STUCK_MS = 20 * 60_000;

// Granular engine step → friendly word. Falls back to the column label.
// String-keyed so an unknown/future phase (e.g. the engine's "idle") just
// misses and falls through rather than failing the build.
const PHASE_LABEL: Record<string, string> = {
  classifying: "Classifying",
  researching: "Researching",
  planning: "Planning",
  running: "Building",
  fixing: "Fixing",
  resolving: "Resolving",
  reviewing: "Reviewing",
  syncing: "Syncing",
  orchestrating: "Orchestrating",
  done: "Done",
  failed: "Failed",
};

function stepLabel(task: KodyTask): string {
  const phase = task.kodyState?.core.phase ?? task.kodyPhase;
  if (phase && PHASE_LABEL[phase]) return PHASE_LABEL[phase];
  return COLUMN_DEFS[task.column].label;
}

/** Most recent sign of life for a task — the run beats the issue timestamp. */
function lastActivityMs(task: KodyTask): number {
  const run = task.workflowRun?.updated_at
    ? Date.parse(task.workflowRun.updated_at)
    : 0;
  const issue = task.updatedAt ? Date.parse(task.updatedAt) : 0;
  return Math.max(run, issue);
}

/** Compact "12s" / "4m" / "2h" from a millisecond gap. */
function shortAgo(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export function HappeningNow({
  tasks,
  tasksLoading,
  updatedAt,
}: {
  tasks: KodyTask[];
  tasksLoading: boolean;
  /** react-query dataUpdatedAt (ms) — when the task list last came back. */
  updatedAt?: number;
}) {
  const now = useNow(15_000); // tick the relative times without re-fetching
  const nowMs = now.getTime();

  const inFlight = tasks
    .filter((t) => IN_FLIGHT_COLUMNS.includes(t.column))
    .map((t) => ({ task: t, quietMs: nowMs - lastActivityMs(t) }))
    .sort((a, b) => a.quietMs - b.quietMs); // freshest activity first

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
          Happening now
        </h2>
        {updatedAt ? (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            updated {shortAgo(nowMs - updatedAt)} ago
          </span>
        ) : null}
      </div>

      {tasksLoading && tasks.length === 0 ? (
        <Card className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </Card>
      ) : inFlight.length === 0 ? (
        <Card className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
          <CircleDot className="w-4 h-4 text-muted-foreground/50" />
          Nothing running right now.
        </Card>
      ) : (
        <Card className="divide-y divide-white/[0.04] overflow-hidden">
          {inFlight.map(({ task, quietMs }) => {
            const stuck = quietMs > STUCK_MS;
            const moving =
              task.column === "building" || task.column === "retrying";
            return (
              <div
                key={task.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.04] transition-colors"
              >
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  {moving && !stuck && (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400/60" />
                  )}
                  <span
                    className={cn(
                      "relative inline-flex h-2.5 w-2.5 rounded-full",
                      stuck
                        ? "bg-rose-400"
                        : moving
                          ? "bg-amber-400"
                          : "bg-sky-400",
                    )}
                  />
                </span>

                <Link
                  href={`/${task.issueNumber}`}
                  className="min-w-0 flex-1 flex items-baseline gap-2"
                >
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-10">
                    #{task.issueNumber}
                  </span>
                  <span
                    {...autoDirProps}
                    className="text-sm truncate text-start"
                  >
                    {task.title}
                  </span>
                </Link>

                <span className="text-xs text-muted-foreground shrink-0">
                  {stepLabel(task)}
                </span>

                <span
                  className={cn(
                    "text-[11px] tabular-nums shrink-0 inline-flex items-center gap-1",
                    stuck ? "text-rose-300" : "text-muted-foreground",
                  )}
                  title={
                    stuck
                      ? "No activity for a while — may be stuck"
                      : "Time since last activity"
                  }
                >
                  <Clock className="w-3 h-3" />
                  {shortAgo(quietMs)}
                  {stuck && " · stuck?"}
                </span>

                {task.workflowRun?.html_url && (
                  <a
                    href={task.workflowRun.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground shrink-0"
                    title="Open the workflow run"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </section>
  );
}
