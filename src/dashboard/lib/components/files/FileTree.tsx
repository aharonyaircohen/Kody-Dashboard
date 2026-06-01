/**
 * @fileType component
 * @domain files
 * @pattern file-tree
 * @ai-summary Hierarchical file tree browser with expand/collapse, icons, and sort.
 */
"use client";

import { useMemo, useState, useCallback } from "react";
import {
  ChevronRight,
  ChevronDown,
  RefreshCw,
  SortAsc,
  SortDesc,
} from "lucide-react";
import { useFilesContext } from "./FilesContext";
import { getFileIcon } from "@dashboard/lib/repo-files-icons";
import type { FileEntry } from "@dashboard/lib/repo-files";
import { cn } from "@dashboard/lib/utils";
import type { SortField, SortDirection } from "./FilesContext";

function formatSize(bytes: number): string {
  if (bytes === 0) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

interface TreeNodeProps {
  entry: FileEntry;
  depth: number;
  selectedPath: string | null;
  onSelect: (entry: FileEntry) => void;
  currentBranch: string;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  children?: React.ReactNode;
}

function TreeNode({
  entry,
  depth,
  selectedPath,
  onSelect,
  expandedPaths,
  onToggleExpand,
  children,
}: TreeNodeProps) {
  const isDir = entry.type === "dir";
  const isExpanded = expandedPaths.has(entry.path);
  const isSelected = selectedPath === entry.path;
  const Icon = getFileIcon(entry.name, entry.type);

  const handleClick = useCallback(() => {
    if (isDir) {
      onToggleExpand(entry.path);
    }
    onSelect(entry);
  }, [isDir, entry, onSelect, onToggleExpand]);

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded text-sm cursor-pointer transition-colors",
          "hover:bg-white/[0.06]",
          isSelected && "bg-accent text-accent-foreground",
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        role="treeitem"
        aria-expanded={isDir ? isExpanded : undefined}
        aria-selected={isSelected}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        {isDir ? (
          <>
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 shrink-0 text-white/40" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 shrink-0 text-white/40" />
            )}
          </>
        ) : (
          <span className="w-3.5" />
        )}
        <Icon className="w-4 h-4 shrink-0 text-white/50" />
        <span className="truncate flex-1">{entry.name}</span>
        {entry.type === "file" && entry.size > 0 && (
          <span className="text-[10px] text-white/30 shrink-0">
            {formatSize(entry.size)}
          </span>
        )}
      </div>
      {isDir && isExpanded && children && <div role="group">{children}</div>}
    </div>
  );
}

interface SortButtonProps {
  field: SortField;
  currentField: SortField;
  direction: SortDirection;
  onChange: (field: SortField) => void;
  children: React.ReactNode;
}

function SortButton({
  field,
  currentField,
  direction,
  onChange,
  children,
}: SortButtonProps) {
  const active = currentField === field;
  return (
    <button
      type="button"
      onClick={() => onChange(field)}
      className={cn(
        "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors",
        active
          ? "text-white/70 bg-white/[0.06]"
          : "text-white/30 hover:text-white/50",
      )}
    >
      {children}
      {active &&
        (direction === "asc" ? (
          <SortAsc className="w-2.5 h-2.5" />
        ) : (
          <SortDesc className="w-2.5 h-2.5" />
        ))}
    </button>
  );
}

export function FileTree() {
  const {
    treeEntries,
    treeLoading,
    treeError,
    currentPath,
    selectedFile,
    selectFile,
    refreshTree,
    sortField,
    sortDirection,
    setSortField,
    currentBranch,
  } = useFilesContext();

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const sortedEntries = useMemo(() => {
    const entries = [...treeEntries];
    entries.sort((a, b) => {
      // Directories first
      if (a.type !== b.type) {
        return a.type === "dir" ? -1 : 1;
      }
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "size":
          cmp = a.size - b.size;
          break;
        case "modified":
          cmp = 0; // We don't have modified time per entry in the listing
          break;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return entries;
  }, [treeEntries, sortField, sortDirection]);

  // Build breadcrumb from current path
  const breadcrumbs = useMemo(() => {
    if (!currentPath) return [];
    const parts = currentPath.split("/").filter(Boolean);
    const crumbs: { name: string; path: string }[] = [];
    let accumulated = "";
    for (const part of parts) {
      accumulated += `/${part}`;
      crumbs.push({ name: part, path: accumulated });
    }
    return crumbs;
  }, [currentPath]);

  if (treeError) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <p className="text-xs text-rose-300 mb-3">{treeError}</p>
        <button
          type="button"
          onClick={refreshTree}
          className="text-xs text-white/50 hover:text-white/70 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" role="tree" aria-label="File tree">
      {/* Header */}
      <div className="shrink-0 px-2 py-2 border-b border-white/[0.06] space-y-1.5">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-[11px] text-white/50 flex-wrap">
          <button
            type="button"
            onClick={() =>
              selectFile({
                name: currentPath || "root",
                path: "",
                type: "dir",
                size: 0,
                sha: "",
                downloadUrl: null,
              })
            }
            className="hover:text-white/70 transition-colors"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
          </button>
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.path} className="flex items-center gap-1">
              <span className="text-white/30">/</span>
              <button
                type="button"
                onClick={() => {
                  const entry = {
                    name: crumb.name,
                    path: crumb.path,
                    type: "dir" as const,
                    size: 0,
                    sha: "",
                    downloadUrl: null,
                  };
                  selectFile(entry);
                }}
                className={cn(
                  "hover:text-white/70 transition-colors",
                  i === breadcrumbs.length - 1 && "text-white/70 font-medium",
                )}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>

        {/* Sort controls */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-white/30 mr-1">Sort:</span>
          <SortButton
            field="name"
            currentField={sortField}
            direction={sortDirection}
            onChange={setSortField}
          >
            Name
          </SortButton>
          <SortButton
            field="size"
            currentField={sortField}
            direction={sortDirection}
            onChange={setSortField}
          >
            Size
          </SortButton>
          <div className="ml-auto">
            <button
              type="button"
              onClick={refreshTree}
              className="p-1 rounded hover:bg-white/[0.06] text-white/40 hover:text-white/60 transition-colors"
              title="Refresh"
            >
              <RefreshCw
                className={cn("w-3 h-3", treeLoading && "animate-spin")}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Tree content */}
      <div className="flex-1 overflow-y-auto py-1">
        {treeLoading && treeEntries.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-4 h-4 animate-spin text-white/40" />
          </div>
        ) : sortedEntries.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-white/40">
            {currentPath ? "This folder is empty" : "No files found"}
          </div>
        ) : (
          <div>
            {sortedEntries.map((entry) => (
              <TreeNode
                key={entry.path}
                entry={entry}
                depth={0}
                selectedPath={selectedFile?.path ?? null}
                onSelect={selectFile}
                currentBranch={currentBranch}
                expandedPaths={expandedPaths}
                onToggleExpand={toggleExpand}
              />
            ))}
          </div>
        )}
      </div>

      {/* Branch indicator */}
      <div className="shrink-0 px-2 py-1.5 border-t border-white/[0.06]">
        <p className="text-[10px] text-white/30 truncate">
          Branch: <span className="text-white/50">{currentBranch}</span>
        </p>
      </div>
    </div>
  );
}
