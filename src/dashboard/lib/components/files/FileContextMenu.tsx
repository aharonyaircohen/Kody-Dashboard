/**
 * @fileType component
 * @domain kody
 * @pattern file-context-menu
 * @ai-summary Right-click context menu for file operations
 */
"use client";

import { useEffect, useRef } from "react";
import {
  Eye,
  Edit3,
  Copy,
  Trash2,
  Download,
  ExternalLink,
  GitBranch,
  History,
  FolderPlus,
  FilePlus,
} from "lucide-react";
import { cn } from "@dashboard/lib/utils/ui";
import type { FileItem } from "./FilesContext";

interface ContextMenuProps {
  x: number;
  y: number;
  file: FileItem | null;
  onClose: () => void;
  onView: (file: FileItem) => void;
  onEdit: (file: FileItem) => void;
  onCopyPath: (file: FileItem) => void;
  onCopyContent: (file: FileItem) => void;
  onDelete: (file: FileItem) => void;
  onDownload: (file: FileItem) => void;
  onOpenGitHub: (file: FileItem) => void;
  onViewHistory: (file: FileItem) => void;
  onNewFile: (path: string) => void;
  onNewFolder: (path: string) => void;
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

function MenuItem({ icon, label, onClick, disabled, danger }: MenuItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 text-sm",
        "hover:bg-accent transition-colors",
        disabled && "opacity-50 cursor-not-allowed",
        danger && "text-destructive hover:text-destructive",
      )}
    >
      <span className="w-4 h-4">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function MenuDivider() {
  return <div className="border-t border-border my-1" />;
}

export function FileContextMenu({
  x,
  y,
  file,
  onClose,
  onView,
  onEdit,
  onCopyPath,
  onCopyContent,
  onDelete,
  onDownload,
  onOpenGitHub,
  onViewHistory,
  onNewFile,
  onNewFolder,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // Adjust position to keep menu in viewport
  useEffect(() => {
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

  const isDir = file?.type === "dir";
  const parentPath = file?.path.includes("/")
    ? file.path.slice(0, file.path.lastIndexOf("/"))
    : "";

  return (
    <div
      ref={menuRef}
      className={cn(
        "fixed z-50 min-w-[180px]",
        "bg-popover border border-border rounded-lg shadow-lg",
        "py-1 animate-in fade-in-0 zoom-in-95",
      )}
      style={{ left: x, top: y }}
    >
      {file ? (
        <>
          <MenuItem
            icon={<Eye />}
            label="View"
            onClick={() => {
              onView(file);
              onClose();
            }}
          />
          {!isDir && (
            <MenuItem
              icon={<Edit3 />}
              label="Edit"
              onClick={() => {
                onEdit(file);
                onClose();
              }}
            />
          )}
          <MenuItem
            icon={<Copy />}
            label="Copy path"
            onClick={() => {
              onCopyPath(file);
              onClose();
            }}
          />
          {!isDir && (
            <MenuItem
              icon={<Copy />}
              label="Copy content"
              onClick={() => {
                onCopyContent(file);
                onClose();
              }}
            />
          )}
          <MenuDivider />
          <MenuItem
            icon={<History />}
            label="View history"
            onClick={() => {
              onViewHistory(file);
              onClose();
            }}
          />
          {!isDir && file.download_url && (
            <MenuItem
              icon={<Download />}
              label="Download"
              onClick={() => {
                onDownload(file);
                onClose();
              }}
            />
          )}
          <MenuItem
            icon={<ExternalLink />}
            label="Open on GitHub"
            onClick={() => {
              onOpenGitHub(file);
              onClose();
            }}
          />
          <MenuDivider />
          <MenuItem
            icon={<FilePlus />}
            label="New file here"
            onClick={() => {
              onNewFile(parentPath);
              onClose();
            }}
            disabled={!parentPath && !isDir}
          />
          <MenuItem
            icon={<FolderPlus />}
            label="New folder here"
            onClick={() => {
              onNewFolder(parentPath || file.path);
              onClose();
            }}
            disabled={!parentPath && !isDir}
          />
          <MenuDivider />
          <MenuItem
            icon={<Trash2 />}
            label="Delete"
            onClick={() => {
              onDelete(file);
              onClose();
            }}
            danger
          />
        </>
      ) : (
        <>
          <MenuItem
            icon={<FilePlus />}
            label="New file"
            onClick={() => {
              onNewFile("");
              onClose();
            }}
          />
          <MenuItem
            icon={<FolderPlus />}
            label="New folder"
            onClick={() => {
              onNewFolder("");
              onClose();
            }}
          />
        </>
      )}
    </div>
  );
}
