/**
 * @fileType component
 * @domain files
 * @pattern file-context-menu
 * @ai-summary Right-click context menu for file/folder operations:
 *   rename, delete, new file, new folder, copy path.
 */
"use client";

import { useEffect, useRef } from "react";
import {
  Trash2,
  Pencil,
  FolderPlus,
  FilePlus,
  Copy,
  Download,
  ExternalLink,
  Link2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@dashboard/lib/utils";
import { canWrite } from "@dashboard/lib/repo-files-perms";
import { useAuth } from "@dashboard/lib/auth-context";

interface FileContextMenuProps {
  x: number;
  y: number;
  path: string;
  pathType?: "file" | "dir" | "symlink";
  onClose: () => void;
  onRename?: (path: string, pathType: "file" | "dir" | "symlink") => void;
  onDelete?: (path: string, pathType: "file" | "dir" | "symlink") => void;
  onDuplicate?: (path: string, pathType: "file" | "dir" | "symlink") => void;
  onDownload?: (path: string, pathType: "file" | "dir" | "symlink") => void;
  onOpenOnGitHub?: (
    path: string,
    pathType: "file" | "dir" | "symlink",
  ) => void;
  onNewFile?: (dirPath: string) => void;
  onNewFolder?: (dirPath: string) => void;
  onCopyPath?: (path: string) => void;
  onCreateSymlink?: (path: string) => void;
}

export function FileContextMenu({
  x,
  y,
  path,
  pathType,
  onClose,
  onRename,
  onDelete,
  onDuplicate,
  onDownload,
  onOpenOnGitHub,
  onNewFile,
  onNewFolder,
  onCopyPath,
  onCreateSymlink,
}: FileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { auth } = useAuth();
  const writeable = canWrite(auth);

  const dirPath =
    pathType === "dir"
      ? path
      : path.includes("/")
        ? path.substring(0, path.lastIndexOf("/"))
        : "";

  useEffect(() => {
    // Adjust position if menu goes off screen
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (rect.right > viewportWidth) {
        menuRef.current.style.left = `${x - rect.width}px`;
      }
      if (rect.bottom > viewportHeight) {
        menuRef.current.style.top = `${y - rect.height}px`;
      }
    }
  }, [x, y]);

  const handleCopyPath = () => {
    navigator.clipboard.writeText(path).then(() => {
      toast.success("Path copied to clipboard");
    });
    onClose();
  };

  const handleRename = () => {
    if (onRename && pathType) onRename(path, pathType);
    onClose();
  };

  const handleDelete = () => {
    if (onDelete && pathType) onDelete(path, pathType);
    onClose();
  };

  const handleDuplicate = () => {
    if (onDuplicate && pathType) onDuplicate(path, pathType);
    onClose();
  };

  const handleDownload = () => {
    if (onDownload && pathType) onDownload(path, pathType);
    onClose();
  };

  const handleOpenOnGitHub = () => {
    if (onOpenOnGitHub && pathType) onOpenOnGitHub(path, pathType);
    onClose();
  };

  const handleNewFile = () => {
    if (onNewFile) onNewFile(dirPath);
    onClose();
  };

  const handleNewFolder = () => {
    if (onNewFolder) onNewFolder(dirPath);
    onClose();
  };

  const handleCreateSymlink = () => {
    if (onCreateSymlink) onCreateSymlink(path);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className={cn(
        "fixed z-50 min-w-[160px] py-1 rounded-lg border border-white/10",
        "bg-zinc-900/95 backdrop-blur shadow-xl",
      )}
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      {onCopyPath && (
        <MenuItem
          icon={<Copy className="w-3.5 h-3.5" />}
          label="Copy path"
          onClick={handleCopyPath}
        />
      )}

      {onOpenOnGitHub && (
        <MenuItem
          icon={<ExternalLink className="w-3.5 h-3.5" />}
          label="Open on GitHub"
          onClick={handleOpenOnGitHub}
        />
      )}

      {pathType === "file" && onDownload && (
        <MenuItem
          icon={<Download className="w-3.5 h-3.5" />}
          label="Download"
          onClick={handleDownload}
        />
      )}

      <MenuDivider />

      {writeable && onNewFile && (
        <MenuItem
          icon={<FilePlus className="w-3.5 h-3.5" />}
          label="New file..."
          onClick={handleNewFile}
        />
      )}

      {writeable && onNewFolder && (
        <MenuItem
          icon={<FolderPlus className="w-3.5 h-3.5" />}
          label="New folder..."
          onClick={handleNewFolder}
        />
      )}

      {writeable && <MenuDivider />}

      {writeable && onRename && (
        <MenuItem
          icon={<Pencil className="w-3.5 h-3.5" />}
          label="Rename or move..."
          onClick={handleRename}
        />
      )}

      {writeable && onDuplicate && (
        <MenuItem
          icon={<Copy className="w-3.5 h-3.5" />}
          label="Duplicate"
          onClick={handleDuplicate}
        />
      )}

      {writeable && onCreateSymlink && (
        <MenuItem
          icon={<Link2 className="w-3.5 h-3.5" />}
          label="New symlink..."
          onClick={handleCreateSymlink}
        />
      )}

      {writeable && onDelete && (
        <>
          <MenuDivider />
          <MenuItem
            icon={<Trash2 className="w-3.5 h-3.5 text-red-400" />}
            label="Delete"
            className="text-red-400 hover:bg-red-500/10"
            onClick={handleDelete}
          />
        </>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left",
        "hover:bg-white/10 text-white/80",
        className,
      )}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function MenuDivider() {
  return <div className="my-1 border-t border-white/10" />;
}
