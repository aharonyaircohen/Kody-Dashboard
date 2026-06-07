/**
 * @fileType component
 * @domain files
 * @pattern files-page
 * @ai-summary Main orchestrator for the /files page. Combines FileTree,
 *   FileViewer, FileEditor, FileSearch, UploadZone, and FileContextMenu into
 *   a responsive split-pane layout with breadcrumb navigation.
 */
"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Octokit } from "@octokit/rest";
import {
  FolderOpen,
  Search,
  Upload,
  ChevronRight,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@dashboard/lib/utils";
import { useAuth } from "@dashboard/lib/auth-context";
import {
  listDir,
  readFile,
  writeFile,
  deleteFile,
} from "@dashboard/lib/repo-files";
import { getFilePermission } from "@dashboard/lib/repo-files-perms";
import { FileTree } from "./FileTree";
import { FileViewer } from "./FileViewer";
import { FileEditor } from "./FileEditor";
import { FileDiffViewer } from "./FileDiffViewer";
import { FileSearch } from "./FileSearch";
import { UploadZone } from "./UploadZone";
import { PageShell } from "@dashboard/lib/components/PageShell";
import { Button } from "@dashboard/ui/button";
import { Input } from "@dashboard/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@dashboard/ui/dialog";

type ViewMode = "viewer" | "editor" | "diff" | "search" | "upload";
type PanelState = "tree" | "split" | "hidden";

interface SelectedFile {
  path: string;
  sha: string;
}

interface BreadcrumbItem {
  path: string;
  label: string;
}

/**
 * Build a breadcrumb trail from a file path.
 * E.g. "src/components/Button.tsx" → [
 *   { path: "src", label: "src" },
 *   { path: "src/components", label: "components" },
 *   { path: "src/components/Button.tsx", label: "Button.tsx" },
 * ]
 */
export function buildBreadcrumbs(path: string): BreadcrumbItem[] {
  if (!path) return [];
  const parts = path.split("/");
  const items: BreadcrumbItem[] = [];
  let acc = "";
  for (const part of parts) {
    acc += acc ? `/${part}` : part;
    items.push({ path: acc, label: part });
  }
  return items;
}

export function normalizeRepoPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
}

export function buildFileHref(path: string | null | undefined): string {
  const normalized = normalizeRepoPath(path ?? "");
  if (!normalized) return "/files";
  return `/files/${normalized.split("/").map(encodeURIComponent).join("/")}`;
}

export function filePathFromHref(pathname: string): string {
  if (pathname === "/files") return "";
  if (!pathname.startsWith("/files/")) return "";
  return normalizeRepoPath(
    pathname
      .slice("/files/".length)
      .split("/")
      .map((part) => {
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      })
      .join("/"),
  );
}

interface FilesPageProps {
  initialPath?: string;
}

export function FilesPage({ initialPath = "" }: FilesPageProps) {
  const { auth } = useAuth();
  const octokit = useMemo(
    () => (auth?.token ? new Octokit({ auth: auth.token }) : null),
    [auth?.token],
  );

  const initialRepoPath = useMemo(
    () => normalizeRepoPath(initialPath),
    [initialPath],
  );
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(
    initialRepoPath || null,
  );
  const [viewMode, setViewMode] = useState<ViewMode>("viewer");
  const [panelState, setPanelState] = useState<PanelState>("split");
  const [showNewFileDialog, setShowNewFileDialog] = useState(false);
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [newItemPath, setNewItemPath] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(
    null,
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const [writeable, setWriteable] = useState(false);
  const openRequestRef = useRef(0);
  const openedInitialPathRef = useRef<string | null>(null);

  // Check write permission on mount / auth change
  useEffect(() => {
    if (!octokit || !auth) {
      setWriteable(false);
      return;
    }
    getFilePermission(octokit, auth.owner, auth.repo).then((p) =>
      setWriteable(p === "write"),
    );
  }, [octokit, auth]);

  // Build breadcrumbs from selected file path
  const breadcrumbs = useMemo<BreadcrumbItem[]>(
    () => (selectedPath ? buildBreadcrumbs(selectedPath) : []),
    [selectedPath],
  );

  const updateFileHref = useCallback(
    (path: string, options: { replace?: boolean } = {}) => {
      if (typeof window === "undefined") return;

      const href = buildFileHref(path);
      if (window.location.pathname === href) return;

      if (options.replace) {
        window.history.replaceState(null, "", href);
      } else {
        window.history.pushState(null, "", href);
      }
    },
    [],
  );

  const openRepoPath = useCallback(
    async (
      path: string,
      options: {
        updateRoute?: boolean;
        replace?: boolean;
        typeHint?: "file" | "dir";
      } = {},
    ) => {
      const normalizedPath = normalizeRepoPath(path);
      const updateRoute = options.updateRoute ?? true;
      const requestId = ++openRequestRef.current;

      if (!normalizedPath) {
        setSelectedPath(null);
        setSelectedFile(null);
        setViewMode("viewer");
        if (updateRoute) updateFileHref("", { replace: options.replace });
        return;
      }

      setSelectedPath(normalizedPath);
      if (options.typeHint === "dir") {
        setSelectedFile(null);
        setViewMode("viewer");
      }
      if (updateRoute) {
        updateFileHref(normalizedPath, { replace: options.replace });
      }

      if (!octokit || !auth) return;

      try {
        const file = await readFile(
          octokit,
          auth.owner,
          auth.repo,
          normalizedPath,
        );
        if (requestId !== openRequestRef.current) return;

        if (file) {
          setSelectedPath(file.path);
          setSelectedFile({ path: file.path, sha: file.sha });
          setViewMode(writeable ? "editor" : "viewer");
          return;
        }

        await listDir(octokit, auth.owner, auth.repo, normalizedPath);
        if (requestId !== openRequestRef.current) return;
        setSelectedFile(null);
        setViewMode("viewer");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to open file");
        if (requestId !== openRequestRef.current) return;
        setSelectedPath(null);
        setSelectedFile(null);
        setViewMode("viewer");
      }
    },
    [octokit, auth, updateFileHref, writeable],
  );

  useEffect(() => {
    if (!octokit || !auth) return;
    const initialOpenKey = `${auth.owner}/${auth.repo}:${initialRepoPath}`;

    if (!initialRepoPath) {
      openedInitialPathRef.current = initialOpenKey;
      setSelectedPath(null);
      setSelectedFile(null);
      setViewMode("viewer");
      return;
    }

    if (openedInitialPathRef.current === initialOpenKey) return;
    openedInitialPathRef.current = initialOpenKey;
    void openRepoPath(initialRepoPath, { updateRoute: false });
  }, [auth, initialRepoPath, octokit, openRepoPath]);

  useEffect(() => {
    if (writeable && selectedFile && viewMode === "viewer") {
      setViewMode("editor");
    }
  }, [selectedFile, viewMode, writeable]);

  useEffect(() => {
    const handlePopState = () => {
      void openRepoPath(filePathFromHref(window.location.pathname), {
        updateRoute: false,
      });
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [openRepoPath]);

  const handleViewDiff = useCallback(() => {
    setViewMode("diff");
  }, []);

  const handleSaved = useCallback(() => {
    // Refresh the file content
    if (selectedFile) {
      openRepoPath(selectedFile.path, { updateRoute: false });
    }
  }, [selectedFile, openRepoPath]);

  const handleCancel = useCallback(() => {
    setViewMode("viewer");
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleNewFile = useCallback((dirPath: string) => {
    setNewItemPath(dirPath ? `${dirPath}/` : "");
    setShowNewFileDialog(true);
  }, []);

  const handleNewFolder = useCallback((dirPath: string) => {
    setNewItemPath(dirPath ? `${dirPath}/` : "");
    setShowNewFolderDialog(true);
  }, []);

  const handleCreateFile = useCallback(
    async (name: string) => {
      if (!octokit || !auth) return;
      const path = newItemPath + name;
      try {
        await writeFile(
          octokit,
          auth.owner,
          auth.repo,
          path,
          "",
          `chore: create ${path}`,
        );
        toast.success(`Created ${path}`);
        setShowNewFileDialog(false);
        setNewItemPath("");
        handleRefresh();
        await openRepoPath(path);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to create file",
        );
      }
    },
    [octokit, auth, newItemPath, handleRefresh, openRepoPath],
  );

  const handleCreateFolder = useCallback(
    async (name: string) => {
      if (!octokit || !auth) return;
      // Creating an "empty" directory via Contents API isn't directly supported,
      // but we can create a .gitkeep file inside it as a workaround
      const folderPath = newItemPath + name;
      const gitkeepPath = `${folderPath}/.gitkeep`;
      try {
        await writeFile(
          octokit,
          auth.owner,
          auth.repo,
          gitkeepPath,
          "",
          `chore: create ${folderPath}/`,
        );
        toast.success(`Created ${folderPath}/`);
        setShowNewFolderDialog(false);
        setNewItemPath("");
        handleRefresh();
        await openRepoPath(folderPath);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to create folder",
        );
      }
    },
    [octokit, auth, newItemPath, handleRefresh, openRepoPath],
  );

  const handleDelete = useCallback(
    async (path: string) => {
      if (!octokit || !auth) return;
      setShowDeleteConfirm(path);
    },
    [octokit, auth],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!octokit || !auth || !showDeleteConfirm) return;
    try {
      // We need the SHA to delete - fetch it first
      const file = await readFile(
        octokit,
        auth.owner,
        auth.repo,
        showDeleteConfirm,
      );
      if (!file) {
        toast.error("File not found");
        return;
      }
      await deleteFile(
        octokit,
        auth.owner,
        auth.repo,
        showDeleteConfirm,
        file.sha,
        `chore: delete ${showDeleteConfirm}`,
      );
      toast.success(`Deleted ${showDeleteConfirm}`);
      if (selectedPath === showDeleteConfirm) {
        setSelectedFile(null);
        setSelectedPath(null);
        setViewMode("viewer");
        updateFileHref("");
      }
      handleRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setShowDeleteConfirm(null);
    }
  }, [
    octokit,
    auth,
    showDeleteConfirm,
    selectedPath,
    updateFileHref,
    handleRefresh,
  ]);

  const handleCreateSymlink = useCallback(
    async (_targetPath: string) => {
      if (!octokit || !auth) return;
      // This would show a dialog for symlink creation
      // Simplified for now
      toast.info("Symlink creation: provide target path and symlink name");
    },
    [octokit, auth],
  );

  const handleRename = useCallback(async (_oldPath: string) => {
    // This would show a rename dialog
    // Simplified for now
    toast.info("Rename: provide new name");
  }, []);

  const handleCopyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path).then(() => {
      toast.success("Path copied to clipboard");
    });
  }, []);

  const handleSearchResultClick = useCallback(
    (path: string, _line?: number) => {
      openRepoPath(path, { typeHint: "file" });
    },
    [openRepoPath],
  );

  const renderMainContent = () => {
    if (viewMode === "search") {
      return (
        <FileSearch
          octokit={octokit}
          owner={auth?.owner ?? ""}
          repo={auth?.repo ?? ""}
          onResultClick={handleSearchResultClick}
          onClose={() => setViewMode(selectedFile ? "viewer" : "search")}
        />
      );
    }

    if (viewMode === "upload") {
      return (
        <UploadZone
          octokit={octokit}
          owner={auth?.owner ?? ""}
          repo={auth?.repo ?? ""}
          onUploadComplete={handleRefresh}
        />
      );
    }

    if (viewMode === "diff" && selectedFile) {
      return (
        <FileDiffViewer
          path={selectedFile.path}
          octokit={octokit}
          owner={auth?.owner ?? ""}
          repo={auth?.repo ?? ""}
          onClose={() => setViewMode("viewer")}
        />
      );
    }

    if (viewMode === "editor" && selectedFile) {
      return (
        <FileEditor
          path={selectedFile.path}
          sha={selectedFile.sha}
          octokit={octokit}
          owner={auth?.owner ?? ""}
          repo={auth?.repo ?? ""}
          onCancel={handleCancel}
          onSaved={handleSaved}
        />
      );
    }

    if (selectedFile) {
      return (
        <FileViewer
          path={selectedFile.path}
          sha={selectedFile.sha}
          octokit={octokit}
          owner={auth?.owner ?? ""}
          repo={auth?.repo ?? ""}
          onViewDiff={handleViewDiff}
        />
      );
    }

    if (selectedPath) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-white/40">
          <FolderOpen className="w-12 h-12 mb-4" />
          <p className="text-sm">/{selectedPath}</p>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center h-full text-white/40">
        <FolderOpen className="w-12 h-12 mb-4" />
        <p className="text-sm">Select a file to view</p>
      </div>
    );
  };

  const actions = (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setViewMode("search")}
        className={cn("gap-1.5", viewMode === "search" && "bg-white/10")}
      >
        <Search className="w-4 h-4" />
        Search
      </Button>

      {writeable && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowNewFileDialog(true)}
          className="gap-1.5"
        >
          New file
        </Button>
      )}

      {writeable && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowNewFolderDialog(true)}
          className="gap-1.5"
        >
          New folder
        </Button>
      )}

      {writeable && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setViewMode("upload")}
          className={cn("gap-1.5", viewMode === "upload" && "bg-white/10")}
        >
          <Upload className="w-4 h-4" />
          Upload
        </Button>
      )}
    </div>
  );

  return (
    <PageShell
      title="Files"
      icon={FolderOpen}
      subtitle={selectedPath ? `/${selectedPath}` : undefined}
      backHref={null}
      actions={actions}
      width="full"
      contentClassName="p-0"
    >
      <div className="flex h-full">
        {/* Left panel - file tree */}
        {panelState !== "hidden" && (
          <div
            className={cn(
              "h-full border-r border-white/10 shrink-0",
              panelState === "split" ? "w-72" : "w-full",
            )}
          >
            {panelState === "split" && (
              <FileTree
                onFileSelect={(path) =>
                  openRepoPath(path, { typeHint: "file" })
                }
                onFolderSelect={(path) =>
                  openRepoPath(path, { typeHint: "dir" })
                }
                selectedPath={selectedPath}
                selectedPathType={
                  selectedFile ? "file" : selectedPath ? "dir" : null
                }
                octokit={octokit}
                owner={auth?.owner ?? ""}
                repo={auth?.repo ?? ""}
                refreshKey={refreshKey}
                onRefresh={handleRefresh}
                onDelete={writeable ? handleDelete : undefined}
                onRename={writeable ? handleRename : undefined}
                onNewFile={writeable ? handleNewFile : undefined}
                onNewFolder={writeable ? handleNewFolder : undefined}
                onCopyPath={handleCopyPath}
                onCreateSymlink={writeable ? handleCreateSymlink : undefined}
              />
            )}
          </div>
        )}

        {/* Right panel - content */}
        <div className="flex-1 min-w-0 h-full flex flex-col">
          {/* Breadcrumb */}
          {breadcrumbs.length > 0 && (
            <div className="flex items-center gap-1 px-4 py-2 border-b border-white/5 text-sm shrink-0">
              <button
                className="text-white/50 hover:text-white/80"
                onClick={() => {
                  void openRepoPath("");
                }}
              >
                <FolderOpen className="w-4 h-4" />
              </button>
              {breadcrumbs.map((crumb, i) => (
                <div key={crumb.path} className="flex items-center gap-1">
                  <ChevronRight className="w-3 h-3 text-white/30" />
                  <button
                    className={cn(
                      "text-xs hover:text-white/80 truncate max-w-[120px]",
                      i === breadcrumbs.length - 1
                        ? "text-white/90"
                        : "text-white/50",
                    )}
                    onClick={() => void openRepoPath(crumb.path)}
                  >
                    {crumb.label}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Main content area */}
          <div className="flex-1 min-h-0">{renderMainContent()}</div>
        </div>

        {/* Toggle panel button */}
        <button
          className={cn(
            "absolute top-4 z-10 p-1 rounded bg-white/5 hover:bg-white/10 text-white/50",
            panelState === "hidden" ? "left-4" : "-left-3",
          )}
          onClick={() =>
            setPanelState((s) =>
              s === "hidden" ? "split" : s === "split" ? "hidden" : "split",
            )
          }
          title={panelState === "hidden" ? "Show tree" : "Hide tree"}
        >
          {panelState === "hidden" ? (
            <PanelLeft className="w-4 h-4" />
          ) : (
            <PanelLeftClose className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* New file dialog */}
      {showNewFileDialog && (
        <Dialog
          open
          onOpenChange={(open) => !open && setShowNewFileDialog(false)}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>New file</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const input = form.elements.namedItem(
                  "filename",
                ) as HTMLInputElement;
                if (input?.value?.trim()) {
                  handleCreateFile(input.value.trim());
                }
              }}
              className="space-y-4"
            >
              <Input
                name="filename"
                placeholder="filename.txt or path/to/file.txt"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowNewFileDialog(false)}
                >
                  Cancel
                </Button>
                <Button type="submit">Create</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* New folder dialog */}
      {showNewFolderDialog && (
        <Dialog
          open
          onOpenChange={(open) => !open && setShowNewFolderDialog(false)}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>New folder</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const input = form.elements.namedItem(
                  "foldername",
                ) as HTMLInputElement;
                if (input?.value?.trim()) {
                  handleCreateFolder(input.value.trim());
                }
              }}
              className="space-y-4"
            >
              <Input
                name="foldername"
                placeholder="folder-name or path/to/folder"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowNewFolderDialog(false)}
                >
                  Cancel
                </Button>
                <Button type="submit">Create</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <Dialog
          open
          onOpenChange={(open) => !open && setShowDeleteConfirm(null)}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete file</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-white/70">
              Delete <code className="text-white/90">{showDeleteConfirm}</code>?
              This cannot be undone.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowDeleteConfirm(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleConfirmDelete}
              >
                Delete
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </PageShell>
  );
}
