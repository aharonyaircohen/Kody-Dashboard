/**
 * @fileType component
 * @domain kody
 * @pattern session-sidebar
 * @ai-summary Session list sidebar for Kody global chat - displays, creates, switches, and deletes sessions
 */
"use client";

import { useState, useRef, useEffect } from "react";
import { Loader2, Pencil, Pin, PinOff, Plus, Trash2, X } from "lucide-react";
import { cn } from "@dashboard/lib/utils/ui";
import { ConfirmDialog } from "./ConfirmDialog";
import type { SessionMeta } from "../chat-types";

interface SessionSidebarProps {
  sessions: SessionMeta[];
  activeSessionId: string | null;
  modeBySessionId?: Record<string, "ai" | "terminal">;
  onSwitchSession: (sessionId: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onPinSession: (sessionId: string) => void;
  pinnedOpen?: boolean;
  onTogglePinnedOpen?: () => void;
  onClose?: () => void;
  className?: string;
  /** True when the chat is in /chat fullscreen mode. Keeps the close (X)
   *  button visible on desktop too — in full mode there's no overlay
   *  click-to-close, and the chat's own "Conversations" toggle can be
   *  hidden if the layout glitches. The X is the always-reachable
   *  fallback. */
  fullscreen?: boolean;
}

/**
 * Format a date as relative time (e.g., "2h ago", "Yesterday")
 */
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  modeBySessionId,
  onSwitchSession,
  onCreateSession,
  onDeleteSession,
  onRenameSession,
  onPinSession,
  pinnedOpen = false,
  onTogglePinnedOpen,
  onClose,
  className,
  fullscreen = false,
}: SessionSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Focus input when editing starts
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const handleStartEdit = (session: SessionMeta) => {
    setEditingId(session.id);
    setEditTitle(
      session.title === "New conversation" && session.preview
        ? session.preview
        : session.title,
    );
  };

  const handleSaveEdit = () => {
    if (editingId && editTitle.trim()) {
      onRenameSession(editingId, editTitle.trim());
    }
    setEditingId(null);
    setEditTitle("");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditTitle("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSaveEdit();
    } else if (e.key === "Escape") {
      handleCancelEdit();
    }
  };

  return (
    <div
      className={cn("flex flex-col h-full bg-background border-r", className)}
    >
      {/* Header */}
      <div className="p-3 border-b">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm">Conversations</h3>
            <span className="text-xs text-muted-foreground">
              {sessions.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {onTogglePinnedOpen && (
              <button
                type="button"
                onClick={onTogglePinnedOpen}
                className={cn(
                  "-mr-1 p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground",
                  pinnedOpen && "text-primary bg-muted",
                )}
                aria-label={
                  pinnedOpen
                    ? "Unpin conversations panel"
                    : "Pin conversations panel"
                }
                title={pinnedOpen ? "Unpin panel" : "Pin panel"}
              >
                {pinnedOpen ? (
                  <PinOff className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <Pin className="w-4 h-4" aria-hidden="true" />
                )}
              </button>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className={cn(
                  "-mr-1 p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground",
                  !fullscreen && "md:hidden",
                )}
                aria-label="Close conversations"
                title="Close"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        <button
          onClick={onCreateSession}
          className="p-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          aria-label="New conversation"
          title="New conversation"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-auto">
        {sessions.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No conversations yet.
            <br />
            Start a new one above.
          </div>
        ) : (
          <ul className="divide-y">
            {sessions.map((session) => (
              <li
                key={session.id}
                className={cn(
                  "group relative cursor-pointer hover:bg-muted/50 transition-colors",
                  session.id === activeSessionId && "bg-muted",
                )}
                onClick={() =>
                  session.id !== activeSessionId && onSwitchSession(session.id)
                }
              >
                <div className="p-3">
                  {/* Title */}
                  {editingId === session.id ? (
                    <input
                      ref={editInputRef}
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={handleSaveEdit}
                      onKeyDown={handleKeyDown}
                      className="w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-primary"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <p
                      className={cn(
                        "flex items-center gap-1.5 text-sm font-medium truncate pr-32 md:pr-20",
                        session.id === activeSessionId && "text-primary",
                      )}
                    >
                      {session.pinned && (
                        <Pin className="w-3 h-3 shrink-0 text-amber-500" />
                      )}
                      {session.status === "running" && (
                        <Loader2 className="w-3 h-3 shrink-0 animate-spin text-primary" />
                      )}
                      <span className="truncate">
                        {session.title === "New conversation" && session.preview
                          ? session.preview
                          : session.title}
                      </span>
                    </p>
                  )}

                  {/* Meta */}
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span
                      className={cn(
                        "rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase leading-none",
                        modeBySessionId?.[session.id] === "terminal"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                          : "border-border bg-muted/50 text-muted-foreground",
                      )}
                    >
                      {modeBySessionId?.[session.id] === "terminal"
                        ? "Terminal"
                        : "Chat"}
                    </span>
                    <span>{formatRelativeTime(session.updatedAt)}</span>
                    <span>•</span>
                    <span>{session.messageCount} messages</span>
                    {session.status === "running" && (
                      <>
                        <span>•</span>
                        <span className="text-primary">Running</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Actions (always visible on mobile, hover-only on ≥md) */}
                <div className="absolute top-1.5 right-1.5 flex gap-0.5 transition-opacity opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                  {/* Pin button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onPinSession(session.id);
                    }}
                    className="p-2 rounded hover:bg-muted text-base leading-none"
                    title={session.pinned ? "Unpin" : "Pin"}
                    aria-label={
                      session.pinned ? "Unpin conversation" : "Pin conversation"
                    }
                  >
                    {session.pinned ? (
                      <PinOff className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <Pin className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>

                  {/* Edit button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStartEdit(session);
                    }}
                    className="p-2 rounded hover:bg-muted text-base leading-none"
                    title="Rename"
                    aria-label="Rename conversation"
                  >
                    <Pencil className="w-4 h-4" aria-hidden="true" />
                  </button>

                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirmId(session.id);
                    }}
                    className="p-2 rounded hover:bg-muted text-destructive text-base leading-none"
                    title="Delete"
                    aria-label="Delete conversation"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={() => {
          if (deleteConfirmId) {
            onDeleteSession(deleteConfirmId);
            setDeleteConfirmId(null);
          }
        }}
        title="Delete conversation?"
        description="This will permanently delete this conversation and all its messages. This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
      />
    </div>
  );
}
