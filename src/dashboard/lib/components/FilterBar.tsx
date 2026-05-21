/**
 * @fileType component
 * @domain kody
 * @pattern filter-bar
 * @ai-summary Dedicated filter sub-header bar for Kody dashboard with view toggle and consolidated filter dropdown
 */
"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "../utils";
import { Search, X } from "lucide-react";
import type { SortField, SortDirection } from "../types";
import { FilterDropdown } from "./FilterDropdown";

export type ViewMode = "running" | "backlog" | "queue";

export interface FilterBarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  dateFilter: string;
  onDateFilterChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  labelFilter: string;
  onLabelFilterChange: (value: string) => void;
  availableLabels: string[];
  labelCounts: Record<string, number>;
  priorityFilter: string;
  onPriorityFilterChange: (value: string) => void;
  statusCounts: Record<string, number>;
  totalCount: number;
  runningCount: number;
  backlogCount: number;
  queueCount?: number;
  /**
   * When true, the Backlog toggle is disabled (goal-grouped view collapses
   * the running/backlog distinction and shows every active task).
   */
  disableBacklog?: boolean;
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
  sortField?: SortField;
  onSortFieldChange?: (field: SortField) => void;
  sortDirection?: SortDirection;
  onSortDirectionChange?: (direction: SortDirection) => void;
  /**
   * Always-visible controls pinned to the left of the strip (e.g. the
   * flat-list / collapse-all view toggles). These stay on screen even when
   * the search + filter cluster is collapsed, so layout switches never cost a
   * reveal click.
   */
  viewToggles?: ReactNode;
}

export interface FilterBarHandle {
  focusSearch: () => void;
}

export { DATE_FILTERS, STATUS_FILTERS } from "./FilterDropdown";

/** Pill-style toggle between Running, Backlog, and Queue views */
export function ViewToggle({
  viewMode,
  onViewModeChange,
  runningCount,
  backlogCount,
  queueCount,
  disableBacklog = false,
}: {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  runningCount: number;
  backlogCount: number;
  queueCount?: number;
  disableBacklog?: boolean;
}) {
  // When backlog is disabled the running/backlog split is meaningless — the
  // entire toggle is suppressed so the goal-grouped view's "all tasks" intent
  // reads at a glance.
  if (disableBacklog) return null;
  return (
    <div className="inline-flex items-center rounded-md bg-white/[0.04] p-0.5 gap-0.5">
      <button
        type="button"
        onClick={() => onViewModeChange("running")}
        className={cn(
          "px-3 py-1 rounded text-xs font-medium transition-colors",
          viewMode === "running"
            ? "bg-blue-600 text-white shadow-sm"
            : "text-muted-foreground hover:text-foreground hover:bg-white/[0.06]",
        )}
      >
        Running ({runningCount})
      </button>
      <button
        type="button"
        onClick={() => onViewModeChange("backlog")}
        className={cn(
          "px-3 py-1 rounded text-xs font-medium transition-colors",
          viewMode === "backlog"
            ? "bg-zinc-600 text-white shadow-sm"
            : "text-muted-foreground hover:text-foreground hover:bg-white/[0.06]",
        )}
      >
        Backlog ({backlogCount})
      </button>
      {/* Queue view retired — left in the ViewMode type for URL backwards-compat
          but the toggle UI no longer exposes it. */}
    </div>
  );
}

export const FilterBar = forwardRef<FilterBarHandle, FilterBarProps>(
  function FilterBar(
    {
      viewMode,
      onViewModeChange,
      dateFilter,
      onDateFilterChange,
      statusFilter,
      onStatusFilterChange,
      labelFilter,
      onLabelFilterChange,
      availableLabels,
      labelCounts,
      priorityFilter,
      onPriorityFilterChange,
      statusCounts,
      totalCount,
      runningCount,
      backlogCount,
      queueCount,
      disableBacklog,
      searchQuery = "",
      onSearchChange,
      sortField = "updatedAt",
      onSortFieldChange,
      sortDirection = "desc",
      onSortDirectionChange,
      viewToggles,
    },
    ref,
  ) {
    const searchInputRef = useRef<HTMLInputElement>(null);

    // The search input + filters are hidden by default behind a toggle to keep
    // the header lean. `pendingFocus` lets `focusSearch()` (the `/` shortcut)
    // expand the row first, then focus once the input has mounted.
    const [expanded, setExpanded] = useState(false);
    const [pendingFocus, setPendingFocus] = useState(false);

    useEffect(() => {
      if (expanded && pendingFocus) {
        searchInputRef.current?.focus();
        setPendingFocus(false);
      }
    }, [expanded, pendingFocus]);

    useImperativeHandle(ref, () => ({
      focusSearch: () => {
        setExpanded(true);
        setPendingFocus(true);
      },
    }));

    // Surface a dot on the collapsed toggle when search or any filter is
    // active, so a hidden filter is never a silent surprise.
    const hasActiveFilters =
      searchQuery.trim() !== "" ||
      viewMode === "backlog" ||
      dateFilter !== "all" ||
      statusFilter !== "all" ||
      labelFilter !== "all" ||
      priorityFilter !== "all";

    return (
      <div className="flex items-center gap-3 px-4 md:px-6 py-2 border-b border-white/[0.06] bg-white/[0.02]">
        {/* Persistent strip: layout toggles (flat-list / collapse-all) stay
            visible at all times so switching views never costs a reveal. */}
        {viewToggles}

        {/* Right cluster: the search + filter controls collapse behind a
            toggle, with the toggle button anchored to the right edge. */}
        <div className="ml-auto flex items-center gap-3">
          {expanded && (
            <>
              {/* View toggle — Running / Backlog. Hidden in goal-grouped view
                  where all tasks are shown together under their goals. */}
              <ViewToggle
                viewMode={viewMode}
                onViewModeChange={onViewModeChange}
                runningCount={runningCount}
                backlogCount={backlogCount}
                queueCount={queueCount}
                disableBacklog={disableBacklog}
              />

              {/* Search input */}
              {onSearchChange && (
                <div className="relative flex items-center">
                  <Search className="absolute left-2.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder="Search tasks…"
                    aria-label="Search tasks"
                    className="h-8 pl-8 pr-7 text-xs rounded-md bg-white/[0.04] border border-white/[0.08] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-white/20 w-40"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => onSearchChange("")}
                      aria-label="Clear search"
                      className="absolute right-2 flex items-center justify-center text-muted-foreground/60 hover:text-foreground"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}

              {/* Consolidated filter dropdown */}
              <FilterDropdown
                dateFilter={dateFilter}
                onDateFilterChange={onDateFilterChange}
                statusFilter={statusFilter}
                onStatusFilterChange={onStatusFilterChange}
                labelFilter={labelFilter}
                onLabelFilterChange={onLabelFilterChange}
                availableLabels={availableLabels}
                labelCounts={labelCounts}
                priorityFilter={priorityFilter}
                onPriorityFilterChange={onPriorityFilterChange}
                statusCounts={statusCounts}
                totalCount={totalCount}
                sortField={sortField}
                onSortFieldChange={onSortFieldChange}
                sortDirection={sortDirection}
                onSortDirectionChange={onSortDirectionChange}
              />
            </>
          )}

          {/* Toggle: reveal/hide the search + filter cluster (also bound to `/`). */}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={
              expanded ? "Hide search and filters" : "Show search and filters"
            }
            title={expanded ? "Hide search & filters" : "Search & filter ( / )"}
            className={cn(
              "relative inline-flex items-center justify-center h-8 w-8 rounded-md border transition-colors shrink-0",
              expanded
                ? "bg-white/[0.08] border-white/[0.15] text-foreground"
                : "bg-white/[0.04] border-white/[0.08] text-muted-foreground hover:text-foreground",
            )}
          >
            <Search className="w-3.5 h-3.5" />
            {!expanded && hasActiveFilters && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-blue-500 ring-2 ring-[#0a0a0a]" />
            )}
          </button>
        </div>
      </div>
    );
  },
);
