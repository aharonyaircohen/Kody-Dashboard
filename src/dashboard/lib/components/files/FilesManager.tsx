/**
 * @fileType component
 * @domain kody
 * @pattern files-manager
 * @ai-summary Main container component for the files browser
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Files,
  FolderTree,
  Search,
  GitCompare,
  Upload,
  ChevronLeft,
  Loader2,
  AlertCircle,
  LayoutGrid,
  List,
  Plus,
  Minus,
  Pencil,
} from "lucide-react";
import { cn } from "@dashboard/lib/utils/ui";
import { useFiles, type FileItem, type BranchInfo } from "./FilesContext";
import { FileTree } from "./FileTree";
import { FileViewer } from "./FileViewer";
import { FileEditor } from "./FileEditor";
import { FileSearch } from "./FileSearch";
import { FileDiffViewer } from "./FileDiffViewer";
import { FileContextMenu } from "./FileContextMenu";
import { UploadZone } from "./UploadZone";
import { MarkdownPreview } from "./MarkdownPreview";

type ViewTab = "browse" | "search" | "diff" | "upload";
type EditMode = "view" | "edit";

interface ContextMenuState {
  x: number;
  y: number;
  file: FileItem | null;
}

export function FilesManager() {
  const {
    currentBranch,
    setCurrentBranch,
    selectedFile,
    setSelectedFile,
    branches,
    setBranches,
    isLoading,
    setIsLoading,
    error,
    setError,
    viewMode,
    setViewMode,
    diffBase,
    diffHead,
    setDiffBase,
    setDiffHead,
    showDiff,
    setShowDiff,
  } = useFiles();

  const [activeTab, setActiveTab] = useState<ViewTab>("browse");
  const [editMode, setEditMode] = useState<EditMode>("view");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [markdownContent, setMarkdownContent] = useState<string>("");

  // Fetch branches on mount
  useEffect(() => {
    const fetchBranches = async () => {
      setIsLoading(true);
      try {
        const res = await fetch("/api/kody/files/branches");
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to fetch branches");
        }
        const data = await res.json();
        setBranches(data.branches || []);
        setCurrentBranch(data.defaultBranch || "main");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    };

    fetchBranches();
  }, [setBranches, setCurrentBranch, setIsLoading, setError]);

  const handleFileSelect = useCallback(
    (file: FileItem) => {
      setSelectedFile(file);
      setEditMode("view");

      // Check if markdown file
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext === "md" || ext === "mdx" || ext === "markdown") {
        // Fetch content for markdown preview
        fetch(
          `/api/kody/files/contents?path=${encodeURIComponent(file.path)}${
            currentBranch ? `&ref=${currentBranch}` : ""
          }`,
        )
          .then((res) => res.json())
          .then((data) => setMarkdownContent(data.content || ""))
          .catch(() => setMarkdownContent(""));
      } else {
        setMarkdownContent("");
      }
    },
    [setSelectedFile, currentBranch],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, file: FileItem | null) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, file });
    },
    [],
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleCopyPath = useCallback(async (file: FileItem) => {
    await navigator.clipboard.writeText(file.path);
  }, []);

  const handleCopyContent = useCallback(
    async (file: FileItem) => {
      const res = await fetch(
        `/api/kody/files/contents?path=${encodeURIComponent(file.path)}${
          currentBranch ? `&ref=${currentBranch}` : ""
        }`,
      );
      const data = await res.json();
      if (data.content) {
        await navigator.clipboard.writeText(data.content);
      }
    },
    [currentBranch],
  );

  const handleDelete = useCallback(
    async (file: FileItem) => {
      if (!confirm(`Delete ${file.path}?`)) return;

      try {
        const res = await fetch(
          `/api/kody/files?path=${encodeURIComponent(file.path)}&ref=${currentBranch}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Delete failed");
        }
        if (selectedFile?.path === file.path) {
          setSelectedFile(null);
        }
      } catch (err) {
        alert(err instanceof Error ? err.message : "Delete failed");
      }
    },
    [currentBranch, selectedFile, setSelectedFile],
  );

  const handleDownload = useCallback((file: FileItem) => {
    if (file.download_url) {
      window.open(file.download_url, "_blank");
    }
  }, []);

  const handleOpenGitHub = useCallback((file: FileItem) => {
    const url = `https://github.com/${file.path}`;
    window.open(url, "_blank");
  }, []);

  const handleViewHistory = useCallback(
    (file: FileItem) => {
      setSelectedFile(file);
      setActiveTab("diff");
      setShowDiff(true);
      setDiffBase(currentBranch || "main");
      setDiffHead(`${file.path}@~10`); // Last 10 commits for this file
    },
    [currentBranch, setSelectedFile, setShowDiff, setDiffBase, setDiffHead],
  );

  const handleSearchResultSelect = useCallback(
    (result: { path: string; name: string; sha: string; type?: string }) => {
      const file: FileItem = {
        name: result.name,
        path: result.path,
        type: "file",
        sha: result.sha,
      };
      setSelectedFile(file);
      setActiveTab("browse");
    },
    [setSelectedFile],
  );

  const handleBranchChange = useCallback(
    (branch: string) => {
      setCurrentBranch(branch);
      setSelectedFile(null);
    },
    [setCurrentBranch, setSelectedFile],
  );

  const isMarkdown = selectedFile
    ? ["md", "mdx", "markdown"].includes(
        selectedFile.name.split(".").pop()?.toLowerCase() || "",
      )
    : false;

  if (isLoading && branches.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && branches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-destructive">
        <AlertCircle className="w-8 h-8 mb-2" />
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          <Files className="w-5 h-5" />
          <h1 className="text-lg font-semibold">Files</h1>
        </div>

        {/* Branch selector */}
        <select
          value={currentBranch}
          onChange={(e) => handleBranchChange(e.target.value)}
          className={cn(
            "px-3 py-1.5 text-sm rounded-md border",
            "bg-background focus:outline-none focus:ring-2 focus:ring-ring",
          )}
        >
          {branches.map((branch) => (
            <option key={branch.name} value={branch.name}>
              {branch.name}
              {branch.isDefault ? " (default)" : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-2 py-1 border-b bg-muted/20">
        <button
          onClick={() => setActiveTab("browse")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors",
            activeTab === "browse"
              ? "bg-background shadow-sm"
              : "hover:bg-accent",
          )}
        >
          <FolderTree className="w-4 h-4" />
          Browse
        </button>
        <button
          onClick={() => setActiveTab("search")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors",
            activeTab === "search"
              ? "bg-background shadow-sm"
              : "hover:bg-accent",
          )}
        >
          <Search className="w-4 h-4" />
          Search
        </button>
        <button
          onClick={() => setActiveTab("diff")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors",
            activeTab === "diff"
              ? "bg-background shadow-sm"
              : "hover:bg-accent",
          )}
        >
          <GitCompare className="w-4 h-4" />
          Diff
        </button>
        <button
          onClick={() => setActiveTab("upload")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors",
            activeTab === "upload"
              ? "bg-background shadow-sm"
              : "hover:bg-accent",
          )}
        >
          <Upload className="w-4 h-4" />
          Upload
        </button>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div
          className={cn(
            "w-64 border-r flex flex-col shrink-0",
            activeTab === "browse" ? "block" : "hidden md:block",
          )}
        >
          {/* View mode toggle */}
          <div className="flex items-center gap-1 px-2 py-1 border-b">
            <button
              onClick={() => setViewMode("tree")}
              className={cn(
                "p-1.5 rounded",
                viewMode === "tree" ? "bg-accent" : "hover:bg-accent",
              )}
              title="Tree view"
            >
              <FolderTree className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={cn(
                "p-1.5 rounded",
                viewMode === "list" ? "bg-accent" : "hover:bg-accent",
              )}
              title="List view"
            >
              <List className="w-4 h-4" />
            </button>
          </div>

          {/* File tree or search */}
          {activeTab === "browse" && viewMode === "tree" && (
            <div
              className="flex-1 overflow-auto"
              onContextMenu={(e) => handleContextMenu(e, null)}
            >
              <FileTree onFileSelect={handleFileSelect} />
            </div>
          )}

          {activeTab === "search" && (
            <div className="flex-1 overflow-auto">
              <FileSearch onResultSelect={handleSearchResultSelect} />
            </div>
          )}
        </div>

        {/* Main panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {activeTab === "browse" && selectedFile && (
            <>
              {/* Toolbar */}
              <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/20">
                <button
                  onClick={() => setEditMode("view")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors",
                    editMode === "view"
                      ? "bg-background shadow-sm"
                      : "hover:bg-accent",
                  )}
                >
                  <LayoutGrid className="w-4 h-4" />
                  View
                </button>
                {selectedFile.type !== "dir" && (
                  <button
                    onClick={() => setEditMode("edit")}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors",
                      editMode === "edit"
                        ? "bg-background shadow-sm"
                        : "hover:bg-accent",
                    )}
                  >
                    <Pencil className="w-4 h-4" />
                    Edit
                  </button>
                )}
                <div className="flex-1" />
                <button
                  onClick={() => setSelectedFile(null)}
                  className="p-1.5 rounded hover:bg-accent"
                  title="Close"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-hidden">
                {isMarkdown && editMode === "view" ? (
                  <MarkdownPreview
                    content={markdownContent}
                    file={selectedFile}
                  />
                ) : editMode === "edit" ? (
                  <FileEditor file={selectedFile} />
                ) : (
                  <FileViewer file={selectedFile} />
                )}
              </div>
            </>
          )}

          {activeTab === "browse" && !selectedFile && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Files className="w-12 h-12 mx-auto mb-2 opacity-20" />
                <p className="text-sm">Select a file to view</p>
              </div>
            </div>
          )}

          {activeTab === "diff" && (
            <div className="flex flex-col h-full">
              {/* Diff controls */}
              <div className="flex items-center gap-3 px-3 py-2 border-b bg-muted/20">
                <span className="text-sm text-muted-foreground">Compare:</span>
                <select
                  value={diffBase}
                  onChange={(e) => setDiffBase(e.target.value)}
                  className={cn(
                    "px-2 py-1 text-sm rounded border",
                    "bg-background focus:outline-none focus:ring-2 focus:ring-ring",
                  )}
                >
                  {branches.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <span className="text-sm text-muted-foreground">to</span>
                <select
                  value={diffHead}
                  onChange={(e) => setDiffHead(e.target.value)}
                  className={cn(
                    "px-2 py-1 text-sm rounded border",
                    "bg-background focus:outline-none focus:ring-2 focus:ring-ring",
                  )}
                >
                  {branches.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Diff viewer */}
              <div className="flex-1 overflow-hidden">
                <FileDiffViewer baseRef={diffBase} headRef={diffHead} />
              </div>
            </div>
          )}

          {activeTab === "upload" && (
            <div className="flex-1 overflow-auto p-4">
              <UploadZone />
            </div>
          )}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          file={contextMenu.file}
          onClose={handleCloseContextMenu}
          onView={handleFileSelect}
          onEdit={(file) => {
            handleFileSelect(file);
            setEditMode("edit");
          }}
          onCopyPath={handleCopyPath}
          onCopyContent={handleCopyContent}
          onDelete={handleDelete}
          onDownload={handleDownload}
          onOpenGitHub={handleOpenGitHub}
          onViewHistory={handleViewHistory}
          onNewFile={(path) => alert(`New file in ${path}`)}
          onNewFolder={(path) => alert(`New folder in ${path}`)}
        />
      )}
    </div>
  );
}
