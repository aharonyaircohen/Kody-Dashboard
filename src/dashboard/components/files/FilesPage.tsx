/**
 * @fileType component
 * @domain files
 * @pattern files-page
 * @ai-summary Main orchestrator for the /files page. Combines FileTree,
 *   FileViewer, FileEditor, FileSearch, UploadZone, and FileContextMenu into
 *   a responsive split-pane layout with breadcrumb navigation.
 */
"use client";

import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  type DragEvent,
} from "react";
import { Octokit } from "@octokit/rest";
import {
  Copy,
  Download,
  ExternalLink,
  FilePlus,
  FolderPlus,
  FolderOpen,
  Search,
  Upload,
  ChevronRight,
  PanelLeftClose,
  PanelLeft,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@dashboard/lib/utils";
import { useAuth } from "@dashboard/lib/auth-context";
import {
  listDir,
  readFile,
  writeFile,
  deleteFile,
  uploadFile,
  type FileContent,
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

type RepoPathType = "file" | "dir" | "symlink";

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

export function parentRepoPath(path: string | null | undefined): string {
  const normalized = normalizeRepoPath(path ?? "");
  if (!normalized.includes("/")) return "";
  return normalized.slice(0, normalized.lastIndexOf("/"));
}

export function currentFolderPath(
  path: string | null | undefined,
  pathType: "file" | "dir" | null,
): string {
  if (pathType === "dir") return normalizeRepoPath(path ?? "");
  if (pathType === "file") return parentRepoPath(path);
  return "";
}

export function joinRepoPath(base: string, child: string): string {
  return normalizeRepoPath(
    [normalizeRepoPath(base), normalizeRepoPath(child)]
      .filter(Boolean)
      .join("/"),
  );
}

export function replacePathPrefix(
  path: string,
  oldPrefix: string,
  newPrefix: string,
): string {
  const normalizedPath = normalizeRepoPath(path);
  const normalizedOld = normalizeRepoPath(oldPrefix);
  const normalizedNew = normalizeRepoPath(newPrefix);
  if (normalizedPath === normalizedOld) return normalizedNew;
  if (!normalizedPath.startsWith(`${normalizedOld}/`)) return normalizedPath;
  return joinRepoPath(normalizedNew, normalizedPath.slice(normalizedOld.length));
}

export function duplicatePath(path: string, pathType: RepoPathType): string {
  const normalized = normalizeRepoPath(path);
  const parent = parentRepoPath(normalized);
  const name = normalized.split("/").pop() ?? normalized;
  if (pathType === "dir") return joinRepoPath(parent, `${name}-copy`);

  const dot = name.lastIndexOf(".");
  const copyName =
    dot > 0 ? `${name.slice(0, dot)} copy${name.slice(dot)}` : `${name} copy`;
  return joinRepoPath(parent, copyName);
}

export function githubFileUrl(
  owner: string,
  repo: string,
  path: string,
  pathType: RepoPathType | null,
): string {
  const normalized = normalizeRepoPath(path);
  const view = pathType === "dir" ? "tree" : "blob";
  const suffix = normalized
    ? `/${normalized.split("/").map(encodeURIComponent).join("/")}`
    : "";
  return `https://github.com/${owner}/${repo}/${view}/HEAD${suffix}`;
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{
    path: string;
    pathType: RepoPathType;
  } | null>(null);
  const [pendingMove, setPendingMove] = useState<{
    path: string;
    pathType: RepoPathType;
  } | null>(null);
  const [moveTarget, setMoveTarget] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [writeable, setWriteable] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const openRequestRef = useRef(0);
  const openedInitialPathRef = useRef<string | null>(null);
  const dragDepthRef = useRef(0);

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

  const selectedPathType: RepoPathType | null = selectedFile
    ? "file"
    : selectedPath
      ? "dir"
      : null;

  const currentFolder = useMemo(
    () => currentFolderPath(selectedPath, selectedPathType),
    [selectedPath, selectedPathType],
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

  const collectFiles = useCallback(
    async function collect(
      path: string,
      pathType: RepoPathType,
    ): Promise<FileContent[]> {
      if (!octokit || !auth) return [];

      if (pathType !== "dir") {
        const file = await readFile(octokit, auth.owner, auth.repo, path);
        if (!file) throw new Error(`File not found: ${path}`);
        return [file];
      }

      const entries = await listDir(octokit, auth.owner, auth.repo, path);
      const files: FileContent[] = [];
      for (const entry of entries) {
        if (entry.type === "dir") {
          files.push(...(await collect(entry.path, "dir")));
        } else if (entry.type === "file") {
          const file = await readFile(
            octokit,
            auth.owner,
            auth.repo,
            entry.path,
          );
          if (file) files.push(file);
        }
      }
      return files;
    },
    [octokit, auth],
  );

  const handleUploadFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!octokit || !auth) {
        toast.error("Not authenticated");
        return;
      }

      const uploadList = Array.from(files).filter((file) => file.name);
      if (uploadList.length === 0) return;

      let uploaded = 0;
      for (const file of uploadList) {
        const destPath = joinRepoPath(currentFolder, file.name);
        try {
          await uploadFile(
            octokit,
            auth.owner,
            auth.repo,
            destPath,
            file,
            `chore: upload ${destPath}`,
          );
          uploaded += 1;
        } catch (err) {
          toast.error(
            err instanceof Error
              ? `Failed to upload ${file.name}: ${err.message}`
              : `Failed to upload ${file.name}`,
          );
        }
      }

      if (uploaded > 0) {
        const folderLabel = currentFolder ? `/${currentFolder}` : "/";
        toast.success(
          `Uploaded ${uploaded} ${uploaded === 1 ? "file" : "files"} to ${folderLabel}`,
        );
        handleRefresh();
      }
    },
    [octokit, auth, currentFolder, handleRefresh],
  );

  const isFileDrag = (e: DragEvent) =>
    Array.from(e.dataTransfer.types).includes("Files");

  const handleDragEnter = useCallback(
    (e: DragEvent) => {
      if (!writeable || !isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current += 1;
      setIsDraggingFiles(true);
    },
    [writeable],
  );

  const handleDragOver = useCallback(
    (e: DragEvent) => {
      if (!writeable || !isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      setIsDraggingFiles(true);
    },
    [writeable],
  );

  const handleDragLeave = useCallback(
    (e: DragEvent) => {
      if (!writeable || !isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setIsDraggingFiles(false);
    },
    [writeable],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      if (!writeable || !isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = 0;
      setIsDraggingFiles(false);
      void handleUploadFiles(e.dataTransfer.files);
    },
    [handleUploadFiles, writeable],
  );

  const handleNewFile = useCallback((dirPath: string) => {
    setNewItemPath(normalizeRepoPath(dirPath));
    setShowNewFileDialog(true);
  }, []);

  const handleNewFolder = useCallback((dirPath: string) => {
    setNewItemPath(normalizeRepoPath(dirPath));
    setShowNewFolderDialog(true);
  }, []);

  const handleCreateFile = useCallback(
    async (name: string) => {
      if (!octokit || !auth) return;
      const path = joinRepoPath(newItemPath, name);
      if (!path) return;
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
      const folderPath = joinRepoPath(newItemPath, name);
      if (!folderPath) return;
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
    async (path: string, pathType: RepoPathType) => {
      if (!octokit || !auth) return;
      setShowDeleteConfirm({ path, pathType });
    },
    [octokit, auth],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!octokit || !auth || !showDeleteConfirm) return;
    const { path, pathType } = showDeleteConfirm;
    setBusyAction("Deleting...");
    try {
      const files = await collectFiles(path, pathType);
      if (files.length === 0) {
        toast.error("Nothing to delete");
        return;
      }
      for (const file of files.reverse()) {
        await deleteFile(
          octokit,
          auth.owner,
          auth.repo,
          file.path,
          file.sha,
          `chore: delete ${path}`,
        );
      }
      toast.success(`Deleted ${path}`);
      if (selectedPath === path || selectedPath?.startsWith(`${path}/`)) {
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
      setBusyAction(null);
    }
  }, [
    octokit,
    auth,
    showDeleteConfirm,
    selectedPath,
    updateFileHref,
    handleRefresh,
    collectFiles,
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

  const handleRename = useCallback((path: string, pathType: RepoPathType) => {
    setPendingMove({ path, pathType });
    setMoveTarget(path);
  }, []);

  const handleConfirmMove = useCallback(async () => {
    if (!octokit || !auth || !pendingMove) return;
    const target = normalizeRepoPath(moveTarget);
    const source = normalizeRepoPath(pendingMove.path);
    if (!target || target === source) return;
    if (pendingMove.pathType === "dir" && target.startsWith(`${source}/`)) {
      toast.error("Choose a folder outside the current folder");
      return;
    }

    setBusyAction("Moving...");
    try {
      const files = await collectFiles(source, pendingMove.pathType);
      if (files.length === 0) {
        toast.error("Nothing to move");
        return;
      }

      for (const file of files) {
        const nextPath =
          pendingMove.pathType === "dir"
            ? replacePathPrefix(file.path, source, target)
            : target;
        await writeFile(
          octokit,
          auth.owner,
          auth.repo,
          nextPath,
          file.content,
          `chore: move ${source} to ${target}`,
        );
      }

      for (const file of [...files].reverse()) {
        await deleteFile(
          octokit,
          auth.owner,
          auth.repo,
          file.path,
          file.sha,
          `chore: remove moved ${source}`,
        );
      }

      toast.success(`Moved ${source} to ${target}`);
      setPendingMove(null);
      setMoveTarget("");
      handleRefresh();
      await openRepoPath(target, {
        typeHint: pendingMove.pathType === "dir" ? "dir" : "file",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to move");
    } finally {
      setBusyAction(null);
    }
  }, [
    octokit,
    auth,
    pendingMove,
    moveTarget,
    collectFiles,
    handleRefresh,
    openRepoPath,
  ]);

  const handleDuplicate = useCallback(
    async (path: string, pathType: RepoPathType) => {
      if (!octokit || !auth) return;
      const source = normalizeRepoPath(path);
      const target = duplicatePath(source, pathType);
      setBusyAction("Duplicating...");
      try {
        const files = await collectFiles(source, pathType);
        if (files.length === 0) {
          toast.error("Nothing to duplicate");
          return;
        }
        for (const file of files) {
          const nextPath =
            pathType === "dir"
              ? replacePathPrefix(file.path, source, target)
              : target;
          await writeFile(
            octokit,
            auth.owner,
            auth.repo,
            nextPath,
            file.content,
            `chore: duplicate ${source}`,
          );
        }
        toast.success(`Duplicated to ${target}`);
        handleRefresh();
        await openRepoPath(target, {
          typeHint: pathType === "dir" ? "dir" : "file",
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to duplicate");
      } finally {
        setBusyAction(null);
      }
    },
    [octokit, auth, collectFiles, handleRefresh, openRepoPath],
  );

  const handleDownload = useCallback(
    async (path: string, pathType: RepoPathType) => {
      if (!octokit || !auth || pathType !== "file") return;
      try {
        const res = await octokit.rest.repos.getContent({
          owner: auth.owner,
          repo: auth.repo,
          path,
        });
        const data = res.data;
        if (Array.isArray(data) || data.type !== "file") {
          throw new Error("File not found");
        }
        const content = (data.content ?? "").replace(/\s/g, "");
        const bytes = Uint8Array.from(atob(content), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes]));
        const a = document.createElement("a");
        a.href = url;
        a.download = path.split("/").pop() ?? "download";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to download");
      }
    },
    [octokit, auth],
  );

  const handleOpenOnGitHub = useCallback(
    (path: string, pathType: RepoPathType) => {
      if (!auth) return;
      window.open(
        githubFileUrl(auth.owner, auth.repo, path, pathType),
        "_blank",
        "noopener,noreferrer",
      );
    },
    [auth],
  );

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
          destinationDir={currentFolder}
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
          onClick={() => handleNewFile(currentFolder)}
          className="gap-1.5"
        >
          <FilePlus className="w-4 h-4" />
          New file
        </Button>
      )}

      {selectedPath && selectedPathType && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleOpenOnGitHub(selectedPath, selectedPathType)}
          className="gap-1.5"
        >
          <ExternalLink className="w-4 h-4" />
          GitHub
        </Button>
      )}

      {selectedFile && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleDownload(selectedFile.path, "file")}
          className="gap-1.5"
        >
          <Download className="w-4 h-4" />
          Download
        </Button>
      )}

      {writeable && selectedPath && selectedPathType && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleRename(selectedPath, selectedPathType)}
          className="gap-1.5"
          disabled={busyAction !== null}
        >
          <Pencil className="w-4 h-4" />
          Move
        </Button>
      )}

      {writeable && selectedPath && selectedPathType && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleDuplicate(selectedPath, selectedPathType)}
          className="gap-1.5"
          disabled={busyAction !== null}
        >
          <Copy className="w-4 h-4" />
          Duplicate
        </Button>
      )}

      {writeable && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleNewFolder(currentFolder)}
          className="gap-1.5"
        >
          <FolderPlus className="w-4 h-4" />
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
      <div
        className="relative flex h-full"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
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
                selectedPathType={selectedPathType}
                octokit={octokit}
                owner={auth?.owner ?? ""}
                repo={auth?.repo ?? ""}
                refreshKey={refreshKey}
                onRefresh={handleRefresh}
                onDelete={writeable ? handleDelete : undefined}
                onRename={writeable ? handleRename : undefined}
                onDuplicate={writeable ? handleDuplicate : undefined}
                onDownload={handleDownload}
                onOpenOnGitHub={handleOpenOnGitHub}
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

        {writeable && isDraggingFiles ? (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="rounded-lg border-2 border-dashed border-emerald-400/60 bg-emerald-500/10 px-8 py-6 text-center">
              <Upload className="mx-auto mb-3 h-8 w-8 text-emerald-300" />
              <p className="text-sm font-medium text-foreground">
                Drop files to upload
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {currentFolder ? `/${currentFolder}` : "/"}
              </p>
            </div>
          </div>
        ) : null}
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
              <p className="text-xs text-muted-foreground">
                Creates in {newItemPath ? `/${newItemPath}` : "/"}.
              </p>
              <Input
                name="filename"
                placeholder="filename.txt or nested/path.txt"
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
              <p className="text-xs text-muted-foreground">
                Creates in {newItemPath ? `/${newItemPath}` : "/"}.
              </p>
              <Input
                name="foldername"
                placeholder="folder-name or nested/path"
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

      {/* Rename / move dialog */}
      {pendingMove && (
        <Dialog open onOpenChange={(open) => !open && setPendingMove(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Rename or move</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleConfirmMove();
              }}
              className="space-y-4"
            >
              <p className="text-xs text-muted-foreground">
                Enter the full new repository path.
              </p>
              <Input
                value={moveTarget}
                onChange={(e) => setMoveTarget(e.target.value)}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setPendingMove(null)}
                  disabled={busyAction !== null}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={busyAction !== null}>
                  {busyAction ?? "Move"}
                </Button>
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
              <DialogTitle>
                Delete {showDeleteConfirm.pathType === "dir" ? "folder" : "file"}
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-white/70">
              Delete{" "}
              <code className="text-white/90">{showDeleteConfirm.path}</code>?
              This cannot be undone.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowDeleteConfirm(null)}
                disabled={busyAction !== null}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleConfirmDelete}
                disabled={busyAction !== null}
              >
                {busyAction ?? "Delete"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </PageShell>
  );
}
