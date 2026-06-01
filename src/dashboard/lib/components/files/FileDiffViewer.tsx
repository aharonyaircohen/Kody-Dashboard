/**
 * @fileType component
 * @domain kody
 * @pattern file-diff-viewer
 * @ai-summary Component for viewing diffs between branches or commits
 */
"use client";

import { useState, useEffect } from "react";
import {
  GitCompare,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileMinus,
  FileEdit,
  File,
} from "lucide-react";
import { cn } from "@dashboard/lib/utils/ui";
import { useFiles, type FileDiff } from "./FilesContext";

interface FileDiffViewerProps {
  baseRef: string;
  headRef: string;
  className?: string;
}

function getDiffStats(diffs: FileDiff[]) {
  const stats = {
    additions: 0,
    deletions: 0,
    files: diffs.length,
  };

  for (const diff of diffs) {
    stats.additions += diff.additions;
    stats.deletions += diff.deletions;
  }

  return stats;
}

function getStatusIcon(status: string) {
  switch (status) {
    case "added":
      return <FilePlus className="w-4 h-4 text-green-500" />;
    case "removed":
      return <FileMinus className="w-4 h-4 text-red-500" />;
    case "modified":
      return <FileEdit className="w-4 h-4 text-yellow-500" />;
    case "renamed":
      return <FileEdit className="w-4 h-4 text-blue-500" />;
    default:
      return <File className="w-4 h-4 text-muted-foreground" />;
  }
}

interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

type DiffLine = {
  type: "context" | "add" | "del";
  content: string;
  oldNum?: number;
  newNum?: number;
};

function parsePatch(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = patch.split("\n");
  let currentHunk: DiffHunk | null = null;

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      currentHunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: parseInt(hunkMatch[2] || "1", 10),
        newStart: parseInt(hunkMatch[3], 10),
        newCount: parseInt(hunkMatch[4] || "1", 10),
        lines: [],
      };
      continue;
    }

    if (currentHunk) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        currentHunk.lines.push({
          type: "add",
          content: line.slice(1),
        });
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        currentHunk.lines.push({
          type: "del",
          content: line.slice(1),
        });
      } else if (line.startsWith(" ") || line === "") {
        currentHunk.lines.push({
          type: "context",
          content: line.slice(1),
        });
      }
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return hunks;
}

export function FileDiffViewer({
  baseRef,
  headRef,
  className,
}: FileDiffViewerProps) {
  const { currentBranch } = useFiles();
  const [diffs, setDiffs] = useState<FileDiff[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!baseRef || !headRef) {
      setDiffs([]);
      return;
    }

    const fetchDiff = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          base: baseRef,
          head: headRef,
        });
        if (currentBranch) params.set("ref", currentBranch);

        const res = await fetch(`/api/kody/files/diff?${params}`);
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to fetch diff");
        }

        const data = await res.json();
        setDiffs(data.files || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchDiff();
  }, [baseRef, headRef, currentBranch]);

  const toggleFile = (path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const stats = getDiffStats(diffs);

  if (!baseRef || !headRef) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center h-full text-muted-foreground",
          className,
        )}
      >
        <GitCompare className="w-12 h-12 mb-2 opacity-20" />
        <p className="text-sm">Select base and head refs to compare</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center h-full text-destructive",
          className,
        )}
      >
        <AlertCircle className="w-8 h-8 mb-2" />
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (diffs.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center h-full text-muted-foreground",
          className,
        )}
      >
        <GitCompare className="w-12 h-12 mb-2 opacity-20" />
        <p className="text-sm">
          No differences between {baseRef} and {headRef}
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-4 text-sm">
          <span className="font-medium">
            {baseRef} → {headRef}
          </span>
          <span className="text-xs text-muted-foreground">
            {stats.files} files
          </span>
          <span className="text-xs text-green-600 dark:text-green-400">
            +{stats.additions}
          </span>
          <span className="text-xs text-red-600 dark:text-red-400">
            -{stats.deletions}
          </span>
        </div>
      </div>

      {/* Diff list */}
      <div className="flex-1 overflow-auto">
        {diffs.map((diff) => {
          const isExpanded = expandedFiles.has(diff.filename);
          const hunks = diff.patch ? parsePatch(diff.patch) : [];

          return (
            <div key={diff.filename} className="border-b">
              <div
                onClick={() => toggleFile(diff.filename)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 cursor-pointer",
                  "hover:bg-accent transition-colors",
                )}
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                )}
                {getStatusIcon(diff.status)}
                <span className="text-sm font-medium flex-1 truncate">
                  {diff.filename}
                </span>
                <span className="text-xs text-green-600 dark:text-green-400">
                  +{diff.additions}
                </span>
                <span className="text-xs text-red-600 dark:text-red-400">
                  -{diff.deletions}
                </span>
              </div>

              {isExpanded && hunks.length > 0 && (
                <div className="bg-zinc-950/50 border-l-2 border-muted">
                  {hunks.map((hunk, hunkIndex) => (
                    <div
                      key={hunkIndex}
                      className="border-b border-zinc-800 last:border-b-0"
                    >
                      <div className="px-3 py-1 bg-blue-500/10 text-blue-300 text-xs font-mono">
                        @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},
                        {hunk.newCount} @@
                      </div>
                      {hunk.lines.map((line, lineIndex) => (
                        <div
                          key={lineIndex}
                          className={cn(
                            "flex font-mono text-xs",
                            line.type === "add" && "bg-green-500/10",
                            line.type === "del" && "bg-red-500/10",
                          )}
                        >
                          <span className="w-12 shrink-0 select-none text-right pr-2 text-zinc-600 border-r border-zinc-800">
                            {line.oldNum ?? ""}
                          </span>
                          <span className="w-12 shrink-0 select-none text-right pr-2 text-zinc-600 border-r border-zinc-800">
                            {line.newNum ?? ""}
                          </span>
                          <span
                            className={cn(
                              "px-2 flex-1",
                              line.type === "add" && "text-green-400",
                              line.type === "del" && "text-red-400",
                            )}
                          >
                            {line.type === "add"
                              ? "+"
                              : line.type === "del"
                                ? "-"
                                : " "}
                            {line.content}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
