/**
 * @fileType component
 * @domain kody
 * @pattern vibe
 * @ai-summary Compact selectable list of open tasks for the Vibe page.
 *   Lighter than TaskList — no actions, no DnD, no inline editing. Tasks are
 *   sorted by updatedAt desc; selecting a row bubbles the issueNumber up so
 *   the parent can swap chat scope + preview iframe. Each row shows a
 *   per-goal colored dot + chip when the task has a `goal:<id>` label.
 */
"use client";

import { useMemo, useState } from "react";
import type { KodyTask } from "../types";
import { cn, formatRelativeTime } from "../utils";
import { CIStatusBadge } from "./CIStatusBadge";
import { MiniPipelineProgress } from "./MiniPipelineProgress";
import {
  AlertCircle,
  GitPullRequest,
  Inbox,
  Loader2,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@dashboard/ui/avatar";
import { useGoals } from "../hooks/useGoals";
import { GOAL_LABEL_PREFIX } from "../goals";
import type { ColumnId } from "../constants";

// Per-column row-background tint. Subtle by default (~4% alpha) so titles
// stay readable; deepens on hover and selection to keep affordances visible.
// "open" uses neutral white so idle tasks don't get a status color.
const COLUMN_ROW_BG: Record<
  ColumnId,
  { idle: string; hover: string; selected: string }
> = {
  open: {
    idle: "",
    hover: "hover:bg-white/[0.03]",
    selected: "bg-white/[0.06]",
  },
  building: {
    idle: "bg-blue-500/[0.05]",
    hover: "hover:bg-blue-500/[0.09]",
    selected: "bg-blue-500/[0.14]",
  },
  review: {
    idle: "bg-purple-500/[0.05]",
    hover: "hover:bg-purple-500/[0.09]",
    selected: "bg-purple-500/[0.14]",
  },
  failed: {
    idle: "bg-red-500/[0.05]",
    hover: "hover:bg-red-500/[0.10]",
    selected: "bg-red-500/[0.16]",
  },
  "gate-waiting": {
    idle: "bg-yellow-500/[0.05]",
    hover: "hover:bg-yellow-500/[0.10]",
    selected: "bg-yellow-500/[0.14]",
  },
  retrying: {
    idle: "bg-orange-500/[0.05]",
    hover: "hover:bg-orange-500/[0.10]",
    selected: "bg-orange-500/[0.14]",
  },
  done: {
    idle: "bg-green-500/[0.04]",
    hover: "hover:bg-green-500/[0.08]",
    selected: "bg-green-500/[0.12]",
  },
};

interface VibeIssueListProps {
  tasks: KodyTask[] | undefined;
  selectedIssueNumber: number | null;
  onSelect: (task: KodyTask | null) => void;
  /**
   * Open the issue card as an overlay on top of the preview pane (NOT a
   * route change). Wiring this through the parent keeps detail open/close
   * scoped to the Vibe page so users never lose their preview + chat scope.
   */
  onOpenDetail: (task: KodyTask) => void;
  isLoading: boolean;
}

// Deterministic palette — hash(goalId) % length picks a stable color per
// goal. Each entry pairs a saturated dot with a softer translucent chip so
// the chip reads as "tinted" rather than "solid color block". Classes are
// listed as literals so Tailwind's JIT picks them up.
const GOAL_PALETTE = [
  {
    dot: "bg-emerald-400",
    chip: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/20",
    border: "border-emerald-400",
  },
  {
    dot: "bg-sky-400",
    chip: "bg-sky-500/10 text-sky-300 ring-sky-500/20",
    border: "border-sky-400",
  },
  {
    dot: "bg-violet-400",
    chip: "bg-violet-500/10 text-violet-300 ring-violet-500/20",
    border: "border-violet-400",
  },
  {
    dot: "bg-amber-400",
    chip: "bg-amber-500/10 text-amber-300 ring-amber-500/20",
    border: "border-amber-400",
  },
  {
    dot: "bg-rose-400",
    chip: "bg-rose-500/10 text-rose-300 ring-rose-500/20",
    border: "border-rose-400",
  },
  {
    dot: "bg-cyan-400",
    chip: "bg-cyan-500/10 text-cyan-300 ring-cyan-500/20",
    border: "border-cyan-400",
  },
  {
    dot: "bg-lime-400",
    chip: "bg-lime-500/10 text-lime-300 ring-lime-500/20",
    border: "border-lime-400",
  },
  {
    dot: "bg-fuchsia-400",
    chip: "bg-fuchsia-500/10 text-fuchsia-300 ring-fuchsia-500/20",
    border: "border-fuchsia-400",
  },
  {
    dot: "bg-orange-400",
    chip: "bg-orange-500/10 text-orange-300 ring-orange-500/20",
    border: "border-orange-400",
  },
  {
    dot: "bg-indigo-400",
    chip: "bg-indigo-500/10 text-indigo-300 ring-indigo-500/20",
    border: "border-indigo-400",
  },
] as const;

function hashGoalId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function goalColor(id: string) {
  return GOAL_PALETTE[hashGoalId(id) % GOAL_PALETTE.length];
}

export function VibeIssueList({
  tasks,
  selectedIssueNumber,
  onSelect,
  onOpenDetail,
  isLoading,
}: VibeIssueListProps) {
  const [query, setQuery] = useState("");
  const { data: goals = [] } = useGoals();

  const goalNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of goals) map.set(g.id, g.name);
    return map;
  }, [goals]);

  // Only open issues — once merged/closed the row vanishes by design.
  // Sort by updatedAt desc so the freshest work surfaces.
  const openTasks = useMemo(() => {
    if (!tasks) return [];
    return [...tasks]
      .filter((t) => t.state === "open")
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }, [tasks]);

  // Match title (case-insensitive substring) or issue number (with or
  // without leading '#'). Empty query falls through unchanged.
  const filteredTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return openTasks;
    const numericQ = q.replace(/^#/, "");
    return openTasks.filter((t) => {
      const titleMatch = t.title.toLowerCase().includes(q);
      const numberMatch = String(t.issueNumber).includes(numericQ);
      return titleMatch || numberMatch;
    });
  }, [openTasks, query]);

  const searchActive = query.trim().length > 0;

  const renderSearchBar = (
    <div className="px-3 py-2.5 border-b border-white/[0.06] bg-black/30 sticky top-0 z-10 backdrop-blur-sm">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title or #number"
          aria-label="Search open issues"
          className="w-full bg-white/[0.04] border border-white/[0.06] rounded-md pl-8 pr-7 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-white/20 focus:bg-white/[0.06] transition-colors"
        />
        {searchActive && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-white/10 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );

  if (isLoading && openTasks.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {renderSearchBar}
        <div className="flex items-center justify-center flex-1">
          <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
        </div>
      </div>
    );
  }

  if (openTasks.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {renderSearchBar}
        <div className="flex flex-col items-center justify-center flex-1 gap-2 px-4 text-center">
          <Inbox className="w-6 h-6 text-zinc-600" />
          <p className="text-xs text-zinc-500">No open issues</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {renderSearchBar}

      {!searchActive && (
        <div className="px-3 pt-2 pb-1">
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={cn(
              "w-full text-left text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors",
              selectedIssueNumber === null
                ? "bg-white/[0.08] text-zinc-100"
                : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300",
            )}
          >
            Default preview
          </button>
        </div>
      )}

      <ul className="flex flex-col divide-y divide-white/[0.04]">
        {searchActive && filteredTasks.length === 0 && (
          <li className="px-4 py-6 text-center">
            <p className="text-xs text-zinc-500">
              No matches for{" "}
              <span className="text-zinc-300">&ldquo;{query}&rdquo;</span>
            </p>
          </li>
        )}
        {filteredTasks.map((task) => {
          const isSelected = task.issueNumber === selectedIssueNumber;
          const hasPR = !!task.associatedPR;

          // First resolvable goal label → chip. Multiple goals are rare;
          // keep the row tight by showing just the first known one.
          let goalId: string | null = null;
          let goalName: string | null = null;
          for (const label of task.labels) {
            if (!label.startsWith(GOAL_LABEL_PREFIX)) continue;
            const id = label.slice(GOAL_LABEL_PREFIX.length);
            const name = goalNameById.get(id);
            if (name) {
              goalId = id;
              goalName = name;
              break;
            }
          }
          const color = goalId ? goalColor(goalId) : null;

          return (
            <li key={task.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => onSelect(task)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(task);
                  }
                }}
                className={cn(
                  "group w-full text-left pl-3 pr-3 py-2.5 border-l-[3px] transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-white/20",
                  color ? color.border : "border-transparent",
                  isSelected
                    ? COLUMN_ROW_BG[task.column].selected
                    : cn(
                        COLUMN_ROW_BG[task.column].idle,
                        COLUMN_ROW_BG[task.column].hover,
                      ),
                )}
                title={goalName ? `Goal: ${goalName}` : undefined}
              >
                {/* Title row — full width, wraps; line-clamp-3 as a sanity bound */}
                <div
                  className={cn(
                    "text-sm leading-snug line-clamp-3 break-words",
                    isSelected
                      ? "text-white font-medium"
                      : "text-zinc-200 group-hover:text-white",
                  )}
                >
                  {task.title}
                </div>

                {/* Meta row */}
                <div className="flex items-center gap-1.5 mt-1.5 min-w-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDetail(task);
                    }}
                    title="Open issue details"
                    className="text-[11px] tabular-nums font-medium text-sky-400 hover:text-sky-300 underline decoration-sky-400/40 hover:decoration-sky-300 underline-offset-2 shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/40 rounded px-0.5"
                  >
                    #{task.issueNumber}
                  </button>

                  {/* Blocked-on-you: jumps out so the user knows to act */}
                  {task.clarifyWaiting && (
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold text-yellow-300 bg-yellow-500/15 ring-1 ring-inset ring-yellow-500/30"
                      title="Engine is waiting for you to answer questions"
                    >
                      <AlertCircle className="w-2.5 h-2.5" />
                      Needs answer
                    </span>
                  )}

                  {hasPR && (
                    <span
                      className="inline-flex items-center px-1 py-0.5 rounded text-purple-300 bg-purple-500/10 ring-1 ring-inset ring-purple-500/20"
                      title="Has open PR"
                    >
                      <GitPullRequest className="w-2.5 h-2.5" />
                    </span>
                  )}
                  {task.associatedPR && (
                    <CIStatusBadge prNumber={task.associatedPR.number} />
                  )}
                  {/* Self-gates: renders only for building/retrying/gate-waiting */}
                  <MiniPipelineProgress task={task} variant="inline" />

                  {/* Gate detail: which stage + hard-stop vs risk-gated */}
                  {task.column === "gate-waiting" && task.gateStage && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ring-1 ring-inset",
                        task.gateType === "hard-stop"
                          ? "text-red-300 bg-red-500/10 ring-red-500/20"
                          : "text-yellow-300 bg-yellow-500/10 ring-yellow-500/20",
                      )}
                      title={
                        task.gateType === "hard-stop"
                          ? `Hard-stop gate at ${task.gateStage}`
                          : `Risk-gated at ${task.gateStage}`
                      }
                    >
                      <ShieldAlert className="w-2.5 h-2.5" />
                      {task.gateStage}
                    </span>
                  )}

                  {/* Right cluster: assignees + time */}
                  {task.assignees && task.assignees.length > 0 && (
                    <div className="flex items-center -space-x-1.5 shrink-0 ml-auto">
                      {task.assignees.slice(0, 2).map((a) => (
                        <Avatar
                          key={a.login}
                          className="h-4 w-4 ring-2 ring-[#0a0a0a]"
                          title={`Assignee: @${a.login}`}
                        >
                          <AvatarImage src={a.avatar_url} alt={a.login} />
                          <AvatarFallback className="text-[8px] bg-zinc-800 text-zinc-400">
                            {a.login[0]?.toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      ))}
                      {task.assignees.length > 2 && (
                        <span
                          className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-zinc-800 text-[8px] font-medium text-zinc-400 ring-2 ring-[#0a0a0a]"
                          title={task.assignees
                            .slice(2)
                            .map((a) => `@${a.login}`)
                            .join(", ")}
                        >
                          +{task.assignees.length - 2}
                        </span>
                      )}
                    </div>
                  )}
                  <span
                    className={cn(
                      "text-[10px] text-zinc-500 shrink-0",
                      !task.assignees || task.assignees.length === 0
                        ? "ml-auto"
                        : "",
                    )}
                  >
                    {formatRelativeTime(task.updatedAt)}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
