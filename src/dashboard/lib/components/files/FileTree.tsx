/**
 * @fileType component
 * @domain kody
 * @pattern file-tree
 * @ai-summary File tree component displaying directory structure with expand/collapse
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Folder,
  FolderOpen,
  File,
  ChevronRight,
  ChevronDown,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { cn } from "@dashboard/lib/utils/ui";
import { useFiles, type FileItem } from "./FilesContext";

interface FileTreeProps {
  onFileSelect: (file: FileItem) => void;
  className?: string;
}

interface TreeNode {
  item: FileItem;
  children: TreeNode[];
  isLoading: boolean;
  isExpanded: boolean;
}

function buildTree(items: FileItem[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirsMap = new Map<string, TreeNode>();

  // Sort: directories first, then files, both alphabetically
  const sorted = [...items].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "dir" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  for (const item of sorted) {
    const node: TreeNode = {
      item,
      children: [],
      isLoading: false,
      isExpanded: false,
    };
    dirsMap.set(item.path, node);

    const parentPath = item.path.includes("/")
      ? item.path.slice(0, item.path.lastIndexOf("/"))
      : "";

    if (!parentPath) {
      root.push(node);
    } else {
      const parent = dirsMap.get(parentPath);
      if (parent) {
        parent.children.push(node);
      } else {
        // Parent directory not in current listing, add to root as orphaned
        root.push(node);
      }
    }
  }

  return root;
}

interface TreeNodeViewProps {
  node: TreeNode;
  level: number;
  onToggle: (path: string) => void;
  onSelect: (item: FileItem) => void;
  selectedPath: string | null;
}

function TreeNodeView({
  node,
  level,
  onToggle,
  onSelect,
  selectedPath,
}: TreeNodeViewProps) {
  const { expandedDirs } = useFiles();
  const isDir = node.item.type === "dir";
  const isExpanded = expandedDirs.has(node.item.path);
  const isSelected = selectedPath === node.item.path;
  const hasChildren = node.children.length > 0;

  const handleClick = () => {
    if (isDir) {
      onToggle(node.item.path);
    } else {
      onSelect(node.item);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <>
      <div
        role="treeitem"
        tabIndex={0}
        aria-expanded={isDir ? isExpanded : undefined}
        aria-selected={isSelected}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded cursor-pointer select-none",
          "hover:bg-accent transition-colors",
          isSelected && "bg-accent",
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        {isDir && (
          <>
            {node.isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />
            ) : (
              <span className="w-4 h-4 flex items-center justify-center shrink-0 text-muted-foreground">
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
              </span>
            )}
          </>
        )}
        {!isDir && <span className="w-4" />}
        <span className="shrink-0 text-muted-foreground">
          {isDir ? (
            isExpanded ? (
              <FolderOpen className="w-4 h-4 text-yellow-500" />
            ) : (
              <Folder className="w-4 h-4 text-yellow-500" />
            )
          ) : (
            <File className="w-4 h-4" />
          )}
        </span>
        <span className="truncate text-sm">{node.item.name}</span>
      </div>
      {isDir && isExpanded && hasChildren && (
        <div role="group">
          {node.children.map((child) => (
            <TreeNodeView
              key={child.item.path}
              node={child}
              level={level + 1}
              onToggle={onToggle}
              onSelect={onSelect}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      )}
    </>
  );
}

export function FileTree({ onFileSelect, className }: FileTreeProps) {
  const {
    currentPath,
    currentBranch,
    selectedFile,
    expandedDirs,
    setExpandedDirs,
    toggleDir,
    setError,
  } = useFiles();

  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedPaths, setLoadedPaths] = useState<Set<string>>(new Set([""]));

  const fetchDirectory = useCallback(
    async (path: string, branch: string) => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (path) params.set("path", path);
        if (branch) params.set("ref", branch);

        const res = await fetch(`/api/kody/files?${params}`);
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to fetch directory");
        }

        const data = await res.json();

        if (data.type === "file") {
          // Path is a file, not a directory
          setItems([]);
        } else {
          setItems(data.items || []);
        }

        // Mark this path as loaded
        setLoadedPaths((prev) => new Set(prev).add(path));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [setError],
  );

  // Fetch root directory on mount and when branch changes
  useEffect(() => {
    if (!currentBranch) return;
    fetchDirectory("", currentBranch);
    setExpandedDirs(new Set());
  }, [currentBranch, fetchDirectory, setExpandedDirs]);

  // Fetch subdirectory when expanded
  const handleToggle = useCallback(
    async (path: string) => {
      if (expandedDirs.has(path)) {
        // Collapse
        toggleDir(path);
      } else {
        // Expand - fetch if not loaded
        if (!loadedPaths.has(path)) {
          await fetchDirectory(path, currentBranch);
        }
        toggleDir(path);
      }
    },
    [expandedDirs, toggleDir, loadedPaths, currentBranch, fetchDirectory],
  );

  const tree = buildTree(items);

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-center justify-between px-2 py-1 border-b">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {currentPath || "Root"}
        </span>
        <button
          onClick={() => fetchDirectory(currentPath, currentBranch)}
          className="p-1 rounded hover:bg-accent transition-colors"
          title="Refresh"
        >
          <RefreshCw
            className={cn(
              "w-3 h-3 text-muted-foreground",
              loading && "animate-spin",
            )}
          />
        </button>
      </div>
      <div
        role="tree"
        className="flex-1 overflow-auto py-1"
        aria-label="File tree"
      >
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : tree.length === 0 ? (
          <div className="px-3 py-4 text-sm text-muted-foreground text-center">
            {currentPath ? "Empty directory" : "No files found"}
          </div>
        ) : (
          tree.map((node) => (
            <TreeNodeView
              key={node.item.path}
              node={node}
              level={0}
              onToggle={handleToggle}
              onSelect={onFileSelect}
              selectedPath={selectedFile?.path ?? null}
            />
          ))
        )}
      </div>
    </div>
  );
}
