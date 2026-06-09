/**
 * @fileType component
 * @domain files
 * @pattern file-tree
 * @ai-summary Lazy-loading hierarchical file tree for the /files page.
 *   Fetches directory contents from the GitHub Contents API on expand.
 */
"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  ChevronDown,
  Loader2,
  RefreshCw,
  SortAsc,
  FileQuestion,
} from "lucide-react";
import { cn } from "@dashboard/lib/utils";
import { listDir, type FileEntry } from "@dashboard/lib/repo-files";
import { getFileIcon } from "@dashboard/lib/repo-files-icons";
import type { Octokit } from "@octokit/rest";
import { FileContextMenu } from "./FileContextMenu";

type SortKey = "name" | "size" | "lastModified";

interface TreeNode {
  entry: FileEntry;
  children: TreeNode[] | null;
  isOpen: boolean;
  isLoading: boolean;
}

interface FileTreeProps {
  onFileSelect: (path: string) => void;
  onFolderSelect?: (path: string) => void;
  selectedPath: string | null;
  selectedPathType?: FileEntry["type"] | null;
  octokit: Octokit | null;
  owner: string;
  repo: string;
  refreshKey?: number;
  onRefresh: () => void;
  onDelete?: (path: string, pathType: FileEntry["type"]) => void;
  onRename?: (path: string, pathType: FileEntry["type"]) => void;
  onDuplicate?: (path: string, pathType: FileEntry["type"]) => void;
  onDownload?: (path: string, pathType: FileEntry["type"]) => void;
  onOpenOnGitHub?: (path: string, pathType: FileEntry["type"]) => void;
  onNewFile?: (dirPath: string) => void;
  onNewFolder?: (dirPath: string) => void;
  onCopyPath?: (path: string) => void;
  onCreateSymlink?: (path: string) => void;
}

export function ancestorPaths(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  return parts
    .slice(0, -1)
    .map((_, index) => parts.slice(0, index + 1).join("/"));
}

export function pathAndAncestorPaths(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function sortEntries(entries: FileEntry[], key: SortKey): FileEntry[] {
  return [...entries].sort((a, b) => {
    // Directories always first
    if (a.type === "dir" && b.type !== "dir") return -1;
    if (a.type !== "dir" && b.type === "dir") return 1;

    switch (key) {
      case "size":
        return b.size - a.size;
      case "lastModified":
        const dateA = a.lastCommit?.date ?? "";
        const dateB = b.lastCommit?.date ?? "";
        return dateB.localeCompare(dateA);
      case "name":
      default:
        return a.name.localeCompare(b.name);
    }
  });
}

/**
 * Build a `TreeNode[]` from a flat list of `FileEntry`s.
 *
 * For each entry, `children` is:
 * - `null` for files and for closed directories (so the render guard
 *   `node.children?.map(...)` renders nothing for them), and
 * - a recursive `TreeNode[]` for open directories whose children are
 *   present in `childrenMap` (or an empty array while children are
 *   still loading — opening a dir renders the row, and the row's
 *   `isLoading` flag shows the spinner).
 *
 * The caller decides what to pass at the top level (the useQuery data
 * for root, or `childrenMap[dirPath]` for a recursive call).
 */
export function buildTree(
  entries: FileEntry[],
  childrenMap: Record<string, FileEntry[]>,
  openPaths: Set<string>,
  loadingPaths: Set<string>,
  sortKey: SortKey,
): TreeNode[] {
  return sortEntries(entries, sortKey).map((entry) => ({
    entry,
    children:
      entry.type === "dir" && openPaths.has(entry.path)
        ? buildTree(
            childrenMap[entry.path] ?? [],
            childrenMap,
            openPaths,
            loadingPaths,
            sortKey,
          )
        : null,
    isOpen: openPaths.has(entry.path),
    isLoading: loadingPaths.has(entry.path),
  }));
}

interface TreeNodeRowProps {
  node: TreeNode;
  depth: number;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onFolderSelect?: (path: string) => void;
  selectedPath: string | null;
  octokit: Octokit;
  owner: string;
  repo: string;
  sortKey: SortKey;
  onContextMenu: (
    e: React.MouseEvent,
    path: string,
    type: FileEntry["type"],
  ) => void;
}

function TreeNodeRow({
  node,
  depth,
  onToggle,
  onSelect,
  onFolderSelect,
  selectedPath,
  octokit,
  owner,
  repo,
  sortKey,
  onContextMenu,
}: TreeNodeRowProps) {
  const { entry, isOpen, isLoading } = node;
  const paddingLeft = depth * 16 + 8;
  const isSelected = selectedPath === entry.path;
  const isDir = entry.type === "dir";

  const Icon = getFileIcon(entry.path, isOpen, entry.type === "symlink", isDir);

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 cursor-pointer rounded text-sm select-none",
          "hover:bg-white/5",
          isSelected && "bg-accent text-accent-foreground",
        )}
        style={{ paddingLeft }}
        onClick={() => {
          if (isDir) {
            onFolderSelect?.(entry.path);
            onToggle(entry.path);
          } else {
            onSelect(entry.path);
          }
        }}
        onContextMenu={(e) => onContextMenu(e, entry.path, entry.type)}
        role="treeitem"
        tabIndex={0}
        aria-expanded={isDir ? isOpen : undefined}
        aria-selected={isSelected}
      >
        {isDir ? (
          isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-white/50 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-white/50 shrink-0" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <Icon className="w-4 h-4 shrink-0 text-white/60" />
        <span className="truncate">{entry.name}</span>
        {isLoading && (
          <Loader2 className="w-3 h-3 animate-spin shrink-0 ml-auto" />
        )}
        {!isLoading && !isDir && (
          <span className="ml-auto text-[10px] text-white/30 shrink-0">
            {formatBytes(entry.size)}
          </span>
        )}
      </div>
      {node.children?.map((child) => (
        <TreeNodeRow
          key={child.entry.path}
          node={child}
          depth={depth + 1}
          onToggle={onToggle}
          onSelect={onSelect}
          onFolderSelect={onFolderSelect}
          selectedPath={selectedPath}
          octokit={octokit}
          owner={owner}
          repo={repo}
          sortKey={sortKey}
          onContextMenu={onContextMenu}
        />
      ))}
    </>
  );
}

export function FileTree({
  onFileSelect,
  onFolderSelect,
  selectedPath,
  selectedPathType = null,
  octokit,
  owner,
  repo,
  refreshKey = 0,
  onRefresh,
  onDelete,
  onRename,
  onDuplicate,
  onDownload,
  onOpenOnGitHub,
  onNewFile,
  onNewFolder,
  onCopyPath,
  onCreateSymlink,
}: FileTreeProps) {
  const [openPaths, setOpenPaths] = useState<Set<string>>(new Set());
  const [childrenMap, setChildrenMap] = useState<Record<string, FileEntry[]>>(
    {},
  );
  const childrenMapRef = useRef(childrenMap);
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
    type: FileEntry["type"];
  } | null>(null);

  // Load root directory
  const { data: rootEntries, isLoading: rootLoading } = useQuery({
    queryKey: ["files-tree", owner, repo, "", refreshKey],
    queryFn: () => listDir(octokit!, owner, repo, ""),
    enabled: !!octokit,
    staleTime: 30_000,
  });

  useEffect(() => {
    childrenMapRef.current = childrenMap;
  }, [childrenMap]);

  useEffect(() => {
    setChildrenMap({});
    childrenMapRef.current = {};
  }, [owner, repo, refreshKey]);

  useEffect(() => {
    if (!octokit || !selectedPath) return;

    const pathsToOpen =
      selectedPathType === "dir"
        ? pathAndAncestorPaths(selectedPath)
        : ancestorPaths(selectedPath);
    if (pathsToOpen.length === 0) return;

    let cancelled = false;

    const openSelectedPath = async () => {
      for (const path of pathsToOpen) {
        if (cancelled) return;

        setOpenPaths((prev) => new Set(prev).add(path));
        if (childrenMapRef.current[path]) continue;

        setLoadingPaths((prev) => new Set(prev).add(path));
        try {
          const entries = await listDir(octokit, owner, repo, path);
          if (cancelled) return;
          setChildrenMap((prev) => {
            if (prev[path]) return prev;
            return { ...prev, [path]: entries };
          });
        } catch {
          // The selected path may be a file; only its real directories open.
        } finally {
          if (!cancelled) {
            setLoadingPaths((prev) => {
              const next = new Set(prev);
              next.delete(path);
              return next;
            });
          }
        }
      }
    };

    void openSelectedPath();

    return () => {
      cancelled = true;
    };
  }, [octokit, owner, repo, refreshKey, selectedPath, selectedPathType]);

  const handleToggle = useCallback(
    async (path: string) => {
      if (openPaths.has(path)) {
        // Close
        setOpenPaths((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      } else {
        // Open — load children if not cached
        if (!childrenMap[path]) {
          setLoadingPaths((prev) => new Set(prev).add(path));
          try {
            const entries = await listDir(octokit!, owner, repo, path);
            setChildrenMap((prev) => ({ ...prev, [path]: entries }));
          } finally {
            setLoadingPaths((prev) => {
              const next = new Set(prev);
              next.delete(path);
              return next;
            });
          }
        }
        setOpenPaths((prev) => new Set(prev).add(path));
      }
    },
    [openPaths, childrenMap, octokit, owner, repo],
  );

  const handleSelect = useCallback(
    (path: string) => {
      onFileSelect(path);
    },
    [onFileSelect],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, path: string, type: FileEntry["type"]) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, path, type });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  useEffect(() => {
    if (contextMenu) {
      const handler = () => closeContextMenu();
      document.addEventListener("click", handler);
      return () => document.removeEventListener("click", handler);
    }
  }, [contextMenu, closeContextMenu]);

  // Build tree nodes from open paths
  const rootNodes: TreeNode[] = rootEntries
    ? buildTree(rootEntries, childrenMap, openPaths, loadingPaths, sortKey)
    : [];

  return (
    <div
      className="flex flex-col h-full"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 shrink-0">
        <button
          className={cn(
            "flex items-center gap-1 text-xs px-2 py-1 rounded",
            sortKey === "name"
              ? "bg-white/10 text-white"
              : "text-white/50 hover:text-white/70",
          )}
          onClick={() => setSortKey("name")}
          title="Sort by name"
        >
          Name
        </button>
        <button
          className={cn(
            "flex items-center gap-1 text-xs px-2 py-1 rounded",
            sortKey === "size"
              ? "bg-white/10 text-white"
              : "text-white/50 hover:text-white/70",
          )}
          onClick={() => setSortKey("size")}
          title="Sort by size"
        >
          Size
        </button>
        <button
          onClick={() => setSortKey("lastModified")}
          className={cn(
            "flex items-center gap-1 text-xs px-2 py-1 rounded",
            sortKey === "lastModified"
              ? "bg-white/10 text-white"
              : "text-white/50 hover:text-white/70",
          )}
          title="Sort by last modified"
        >
          <SortAsc className="w-3 h-3" />
          Date
        </button>
        <button
          onClick={onRefresh}
          className="ml-auto p-1 rounded hover:bg-white/10 text-white/50 hover:text-white"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1" role="tree">
        {rootLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-white/40" />
          </div>
        ) : rootNodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-white/40 text-sm">
            <FileQuestion className="w-8 h-8 mb-2" />
            <span>This folder is empty</span>
          </div>
        ) : (
          rootNodes.map((node) => (
            <TreeNodeRow
              key={node.entry.path}
              node={node}
              depth={0}
              onToggle={handleToggle}
              onSelect={handleSelect}
              onFolderSelect={onFolderSelect}
              selectedPath={selectedPath}
              octokit={octokit!}
              owner={owner}
              repo={repo}
              sortKey={sortKey}
              onContextMenu={handleContextMenu}
            />
          ))
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          path={contextMenu.path}
          pathType={contextMenu.type}
          onClose={closeContextMenu}
          onDelete={onDelete}
          onRename={onRename}
          onDuplicate={onDuplicate}
          onDownload={onDownload}
          onOpenOnGitHub={onOpenOnGitHub}
          onNewFile={onNewFile}
          onNewFolder={onNewFolder}
          onCopyPath={onCopyPath}
          onCreateSymlink={onCreateSymlink}
        />
      )}
    </div>
  );
}
