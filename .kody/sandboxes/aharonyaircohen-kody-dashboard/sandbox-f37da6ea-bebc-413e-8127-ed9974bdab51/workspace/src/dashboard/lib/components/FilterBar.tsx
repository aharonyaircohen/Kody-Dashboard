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
    },
    ref,
  ) {
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Search collapses to an icon button until invoked, to keep the merged
    // header lean. It stays open while a query is present so the active filter
    // never hides. `focusReq` re-fires the focus effect even when already open
    // (e.g. pressing `/` twice).
    const [searchOpen, setSearchOpen] = useState(false);
    const [focusReq, setFocusReq] = useState(0);
    const showSearchInput = searchOpen || searchQuery.trim() !== "";

    useEffect(() => {
      if (focusReq > 0) searchInputRef.current?.focus();
    }, [focusReq]);

    const requestSearch = () => {
      setSearchOpen(true);
      setFocusReq((n) => n + 1);
    };

    useImperativeHandle(ref, () => ({
      focusSearch: requestSearch,
    }));

    return (
      // Inline cluster — the host (KodyHeader) owns the row chrome now that the
      // filter controls live in the merged top bar, not a standalone sub-row.
      <div className="flex items-center gap-3">
        {/* View toggle — Running / Backlog. Hidden in goal-grouped view where
          all tasks are shown together under their goal sections. */}
        <ViewToggle
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          runningCount={runningCount}
          backlogCount={backlogCount}
          queueCount={queueCount}
          disableBacklog={disableBacklog}
        />

        {/* Search — collapses to an icon button until clicked or `/`. */}
        {onSearchChange &&
          (showSearchInput ? (
            <div className="relative flex items-center">
              <Search className="absolute left-2.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                onBlur={() => {
                  if (searchQuery.trim() === "") setSearchOpen(false);
                }}
                placeholder="Search tasks…"
                aria-label="Search tasks"
                className="h-8 pl-8 pr-7 text-xs rounded-md bg-white/[0.04] border border-white/[0.08] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-white/20 w-40"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    onSearchChange("");
                    requestSearch();
                  }}
                  aria-label="Clear search"
                  className="absolute right-2 flex items-center justify-center text-muted-foreground/60 hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={requestSearch}
              aria-label="Search tasks"
              title="Search ( / )"
              className="inline-flex items-center justify-center h-8 w-8 rounded-md bg-white/[0.04] border border-white/[0.08] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground transition-colors shrink-0"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          ))}

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
      </div>
    );
  },
);
