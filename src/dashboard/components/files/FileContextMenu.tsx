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
  onClose: () => void;
  onRename?: (path: string) => void;
  onDelete?: (path: string) => void;
  onNewFile?: (dirPath: string) => void;
  onNewFolder?: (dirPath: string) => void;
  onCopyPath?: (path: string) => void;
  onCreateSymlink?: (path: string) => void;
}

export function FileContextMenu({
  x,
  y,
  path,
  onClose,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
  onCopyPath,
  onCreateSymlink,
}: FileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { auth } = useAuth();
  const writeable = canWrite(auth);

  const dirPath = path.includes("/")
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
    if (onRename) onRename(path);
    onClose();
  };

  const handleDelete = () => {
    if (onDelete) onDelete(path);
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
          label="Rename..."
          onClick={handleRename}
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
