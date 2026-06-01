/**
 * @fileType component
 * @domain files
 * @pattern file-context-menu
 * @ai-summary Right-click context menu for file operations (rename, delete, symlink).
 */
"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useFilesContext } from "./FilesContext";
import {
  deleteFile,
  renameFile,
  createDirectory,
} from "@dashboard/lib/repo-files";
import { canWrite, writeTooltip } from "@dashboard/lib/repo-files-perms";

interface ContextMenuState {
  x: number;
  y: number;
  entry: {
    path: string;
    name: string;
    type: string;
    sha: string;
    size: number;
    downloadUrl: string | null;
  } | null;
}

export function useFileContextMenu() {
  const {
    selectedFile,
    currentBranch,
    currentPath,
    refreshTree,
    clearSelectedFile,
  } = useFilesContext();

  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, entry: typeof selectedFile) => {
      if (!entry) return;
      e.preventDefault();
      e.stopPropagation();
      setMenu({ x: e.clientX, y: e.clientY, entry });
    },
    [],
  );

  const closeMenu = useCallback(() => {
    setMenu(null);
  }, []);

  const handleRename = useCallback(async () => {
    if (!menu?.entry || !renameValue.trim()) return;
    const oldPath = menu.entry.path;
    const parts = oldPath.split("/");
    parts[parts.length - 1] = renameValue.trim();
    const newPath = parts.join("/");
    setRenaming(true);
    try {
      await renameFile({
        path: oldPath,
        targetPath: newPath,
        sha: menu.entry.sha,
        message: `Rename ${menu.entry.name} to ${renameValue.trim()}`,
        ref: currentBranch,
      });
      toast.success("Renamed");
      closeMenu();
      refreshTree();
      if (selectedFile?.path === oldPath) {
        clearSelectedFile();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Rename failed";
      toast.error(msg);
    } finally {
      setRenaming(false);
      setRenameValue("");
    }
  }, [
    menu,
    renameValue,
    currentBranch,
    refreshTree,
    selectedFile,
    clearSelectedFile,
    closeMenu,
  ]);

  const handleDelete = useCallback(async () => {
    if (!menu?.entry) return;
    const confirmed = window.confirm(
      `Delete "${menu.entry.path}"? This cannot be undone.`,
    );
    if (!confirmed) return;
    setDeleting(true);
    try {
      await deleteFile({
        path: menu.entry.path,
        sha: menu.entry.sha,
        message: `Delete ${menu.entry.name}`,
        ref: currentBranch,
      });
      toast.success("Deleted");
      closeMenu();
      refreshTree();
      if (selectedFile?.path === menu.entry.path) {
        clearSelectedFile();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Delete failed";
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  }, [
    menu,
    currentBranch,
    refreshTree,
    selectedFile,
    clearSelectedFile,
    closeMenu,
  ]);

  const handleNewFile = useCallback(async () => {
    if (!newFileName.trim()) return;
    const basePath =
      selectedFile?.type === "dir" ? selectedFile.path : currentPath;
    const fullPath = basePath
      ? `${basePath}/${newFileName.trim()}`
      : newFileName.trim();
    setIsCreatingFile(true);
    try {
      await createFile({
        path: fullPath,
        content: "",
        message: `Create ${newFileName.trim()}`,
        ref: currentBranch,
      } as Parameters<typeof createFile>[0]);
      toast.success("File created");
      closeMenu();
      setShowNewFile(false);
      setNewFileName("");
      refreshTree();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Create failed";
      toast.error(msg);
    } finally {
      setIsCreatingFile(false);
    }
  }, [newFileName, selectedFile, currentBranch, refreshTree, closeMenu]);

  const handleNewFolder = useCallback(async () => {
    if (!newFolderName.trim()) return;
    const basePath =
      selectedFile?.type === "dir" ? selectedFile.path : currentPath;
    const fullPath = basePath
      ? `${basePath}/${newFolderName.trim()}`
      : newFolderName.trim();
    setIsCreatingFolder(true);
    try {
      await createDirectory({
        path: fullPath,
        message: `Create directory ${newFolderName.trim()}`,
        ref: currentBranch,
      });
      toast.success("Directory created");
      closeMenu();
      setShowNewFolder(false);
      setNewFolderName("");
      refreshTree();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Create failed";
      toast.error(msg);
    } finally {
      setIsCreatingFolder(false);
    }
  }, [newFolderName, selectedFile, currentBranch, refreshTree, closeMenu]);

  // Import createFile

  const createFile = async ({
    path,
    content,
    message,
    ref,
  }: {
    path: string;
    content: string;
    message: string;
    ref?: string;
  }) => {
    const res = await fetch("/api/kody/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "write",
        path,
        content: Buffer.from(content, "utf-8").toString("base64"),
        message,
        ref,
      }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
  };

  const contextMenu = menu ? (
    <>
      <div className="fixed inset-0 z-40" onClick={closeMenu} />
      <div
        className="fixed bg-zinc-900 border border-white/10 rounded-lg shadow-2xl z-50 py-1 min-w-[160px]"
        style={{ left: menu.x, top: menu.y }}
      >
        {canWrite() ? (
          <>
            <button
              type="button"
              onClick={() => {
                setRenameValue(menu.entry?.name ?? "");
                setRenaming(true);
                closeMenu();
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-white/70 hover:bg-white/[0.06] transition-colors"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => {
                setShowNewFile(true);
                closeMenu();
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-white/70 hover:bg-white/[0.06] transition-colors"
            >
              New File…
            </button>
            <button
              type="button"
              onClick={() => {
                setShowNewFolder(true);
                closeMenu();
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-white/70 hover:bg-white/[0.06] transition-colors"
            >
              New Folder…
            </button>
            <div className="my-1 border-t border-white/[0.06]" />
            <button
              type="button"
              onClick={() => handleDelete()}
              disabled={deleting}
              className="w-full text-left px-3 py-1.5 text-sm text-rose-300 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </>
        ) : (
          <div className="px-3 py-1.5 text-xs text-white/30">
            {writeTooltip() || "No write access"}
          </div>
        )}
      </div>

      {/* Rename dialog */}
      {renaming && menu.entry && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-white/10 rounded-lg p-5 w-full max-w-md mx-4 shadow-2xl">
            <h3 className="text-sm font-semibold mb-3">Rename</h3>
            <input
              autoFocus
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") setRenaming(false);
              }}
              className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:border-white/20"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                type="button"
                onClick={() => setRenaming(false)}
                className="px-3 py-1.5 rounded text-xs text-white/50 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRename}
                disabled={
                  !renameValue.trim() || renameValue === menu.entry?.name
                }
                className="px-3 py-1.5 rounded text-xs bg-white/10 hover:bg-white/20 text-white/90 transition-colors disabled:opacity-50"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New file dialog */}
      {showNewFile && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-white/10 rounded-lg p-5 w-full max-w-md mx-4 shadow-2xl">
            <h3 className="text-sm font-semibold mb-3">New File</h3>
            <input
              autoFocus
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder="filename.txt"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNewFile();
                if (e.key === "Escape") setShowNewFile(false);
              }}
              className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:border-white/20"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                type="button"
                onClick={() => setShowNewFile(false)}
                className="px-3 py-1.5 rounded text-xs text-white/50 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleNewFile}
                disabled={!newFileName.trim() || isCreatingFile}
                className="px-3 py-1.5 rounded text-xs bg-white/10 hover:bg-white/20 text-white/90 transition-colors disabled:opacity-50"
              >
                {isCreatingFile ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New folder dialog */}
      {showNewFolder && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-white/10 rounded-lg p-5 w-full max-w-md mx-4 shadow-2xl">
            <h3 className="text-sm font-semibold mb-3">New Folder</h3>
            <input
              autoFocus
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="folder-name"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNewFolder();
                if (e.key === "Escape") setShowNewFolder(false);
              }}
              className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:border-white/20"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                type="button"
                onClick={() => setShowNewFolder(false)}
                className="px-3 py-1.5 rounded text-xs text-white/50 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleNewFolder}
                disabled={!newFolderName.trim() || isCreatingFolder}
                className="px-3 py-1.5 rounded text-xs bg-white/10 hover:bg-white/20 text-white/90 transition-colors disabled:opacity-50"
              >
                {isCreatingFolder ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  ) : null;

  return {
    contextMenu,
    handleContextMenu,
    closeMenu,
  };
}
