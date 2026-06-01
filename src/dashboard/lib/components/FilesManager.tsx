/**
 * @fileType component
 * @domain files
 * @pattern files-manager
 * @ai-summary Main file browser component orchestrating tree, viewer, editor, and search.
 */
"use client";

import { useCallback, useState } from "react";
import {
  Upload,
  Plus,
  FolderPlus,
  PanelLeftClose,
  PanelLeft,
  GitBranch,
} from "lucide-react";
import { useFilesContext, FilesProvider } from "./files/FilesContext";
import { FileTree } from "./files/FileTree";
import { FileViewer } from "./files/FileViewer";
import { FileEditor } from "./files/FileEditor";
import { FileDiffViewer } from "./files/FileDiffViewer";
import { MarkdownPreview } from "./files/MarkdownPreview";
import { FileSearch } from "./files/FileSearch";
import { UploadZone } from "./files/UploadZone";
import { useFileContextMenu } from "./files/FileContextMenu";
import { canWrite, writeTooltip } from "../repo-files-perms";
import { readFile } from "../repo-files";
import { cn } from "../utils";
import { toast } from "sonner";
import type { BranchInfo } from "../repo-files";

function FilesManagerInner() {
  const {
    currentBranch,
    setCurrentBranch,
    branches,
    viewMode,
    setViewMode,
    selectedFile,
    selectFile,
    treeCollapsed,
    setTreeCollapsed,
    setOriginalContent,
    setFileContent,
  } = useFilesContext();

  const [showDiff, setShowDiff] = useState(false);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const { contextMenu, handleContextMenu } = useFileContextMenu();
  const writable = canWrite();

  const handleStartEdit = useCallback(() => {
    setViewMode("edit");
  }, [setViewMode]);

  const handleSaved = useCallback(() => {
    // After saving, revert to view mode and refresh content
    setViewMode("view");
    if (selectedFile) {
      readFile(selectedFile.path, currentBranch)
        .then((content) => {
          setFileContent(content);
          setOriginalContent(content.content);
        })
        .catch(() => {
          toast.error("Failed to refresh file content");
        });
    }
  }, [
    selectedFile,
    currentBranch,
    setViewMode,
    setFileContent,
    setOriginalContent,
  ]);

  const handlePreview = useCallback(() => {
    setViewMode("preview");
  }, [setViewMode]);

  const handleSplitView = useCallback(() => {
    setViewMode("split");
  }, [setViewMode]);

  const handleBackToEdit = useCallback(() => {
    setViewMode("edit");
  }, [setViewMode]);

  const handleSelectSearchResult = useCallback(
    async (path: string) => {
      try {
        // Read the file to get its entry info
        const content = await readFile(path, currentBranch);
        // Find in tree or create a synthetic entry
        const name = path.split("/").pop() ?? path;
        const entry = {
          name,
          path,
          type: "file" as const,
          size: content.size,
          sha: content.sha,
          downloadUrl: null,
        };
        selectFile(entry);
      } catch (_err) {
        toast.error("Failed to open file");
      }
    },
    [currentBranch, selectFile],
  );

  const handleBranchSelect = useCallback(
    (branch: BranchInfo) => {
      setCurrentBranch(branch.name);
      setShowBranchPicker(false);
    },
    [setCurrentBranch],
  );

  return (
    <div
      className="flex flex-col h-full bg-black/95 text-white/90"
      onContextMenu={(e) => {
        // Allow native context menu on text selection
        const selection = window.getSelection();
        if (selection?.toString()) return;
        handleContextMenu(e, selectedFile);
      }}
    >
      {/* Top toolbar */}
      <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-2 border-b border-white/[0.06] bg-white/[0.02]">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setTreeCollapsed(!treeCollapsed)}
            className="p-1.5 rounded hover:bg-white/[0.06] text-white/50 hover:text-white/70 transition-colors shrink-0"
            title={treeCollapsed ? "Show file tree" : "Hide file tree"}
          >
            {treeCollapsed ? (
              <PanelLeft className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>

          {/* Branch selector */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowBranchPicker(!showBranchPicker)}
              className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/[0.05] border border-white/10 text-xs text-white/70 hover:border-white/20 transition-colors max-w-[160px]"
            >
              <GitBranch className="w-3.5 h-3.5 shrink-0 text-white/40" />
              <span className="truncate">{currentBranch}</span>
            </button>
            {showBranchPicker && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowBranchPicker(false)}
                />
                <div className="absolute top-full left-0 mt-1 bg-zinc-900 border border-white/10 rounded-lg shadow-2xl z-50 w-56 max-h-64 overflow-y-auto">
                  {branches.map((b) => (
                    <button
                      key={b.name}
                      type="button"
                      onClick={() => handleBranchSelect(b)}
                      className={cn(
                        "w-full text-left px-3 py-1.5 text-xs transition-colors",
                        b.name === currentBranch
                          ? "bg-white/[0.08] text-white/90"
                          : "text-white/60 hover:bg-white/[0.05]",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <GitBranch className="w-3 h-3 shrink-0 text-white/30" />
                        <span className="truncate">{b.name}</span>
                        {b.isDefault && (
                          <span className="text-[9px] text-emerald-400/60 ml-auto">
                            default
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="flex-1 max-w-xs mx-4">
          <FileSearch onSelectResult={handleSelectSearchResult} />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {writable && (
            <>
              <button
                type="button"
                onClick={() => {
                  const name = window.prompt("File name:");
                  if (name) {
                    toast.info("Creating file… (not yet implemented)");
                  }
                }}
                className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-white/50 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
                title="New File"
              >
                <Plus className="w-3.5 h-3.5" />
                New File
              </button>
              <button
                type="button"
                onClick={() => {
                  const name = window.prompt("Folder name:");
                  if (name) {
                    toast.info("Creating folder… (not yet implemented)");
                  }
                }}
                className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-white/50 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
                title="New Folder"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                New Folder
              </button>
              <button
                type="button"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.multiple = true;
                  input.onchange = () => {
                    const files = Array.from(input.files ?? []);
                    if (files.length > 0) {
                      toast.info("Uploading… (not yet implemented)");
                    }
                  };
                  input.click();
                }}
                className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-white/50 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
                title="Upload"
              >
                <Upload className="w-3.5 h-3.5" />
                Upload
              </button>
            </>
          )}
          {!writable && (
            <span
              className="text-[10px] text-white/30 italic px-2"
              title={writeTooltip()}
            >
              Read-only
            </span>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* File tree sidebar */}
        {!treeCollapsed && (
          <div className="w-64 shrink-0 border-r border-white/[0.06] flex flex-col overflow-hidden">
            <FileTree />
          </div>
        )}

        {/* Editor area */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {showDiff ? (
            <FileDiffViewer onClose={() => setShowDiff(false)} />
          ) : viewMode === "preview" ? (
            <MarkdownPreview onBack={handleBackToEdit} />
          ) : viewMode === "edit" ? (
            <FileEditor
              onCancel={() => setViewMode("view")}
              onSaved={handleSaved}
              onOpenHistory={() => setShowDiff(true)}
              onPreview={handlePreview}
              onSplitView={handleSplitView}
              showPreview={false}
              showSplit={false}
            />
          ) : viewMode === "split" ? (
            <div className="flex h-full">
              <div className="flex-1 border-r border-white/[0.06]">
                <FileEditor
                  onCancel={() => setViewMode("view")}
                  onSaved={handleSaved}
                  onOpenHistory={() => setShowDiff(true)}
                  onPreview={handlePreview}
                  onSplitView={handleSplitView}
                  showPreview={false}
                  showSplit={true}
                />
              </div>
              <div className="flex-1">
                <MarkdownPreview onBack={handleBackToEdit} />
              </div>
            </div>
          ) : (
            <FileViewer
              onOpenHistory={() => setShowDiff(true)}
              onStartEdit={handleStartEdit}
            />
          )}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu}

      {/* Upload zone */}
      <UploadZone>
        <div />
      </UploadZone>
    </div>
  );
}

export function FilesManager() {
  return (
    <FilesProvider>
      <FilesManagerInner />
    </FilesProvider>
  );
}
