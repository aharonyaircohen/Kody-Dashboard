/**
 * @fileType component
 * @domain preview
 * @pattern view-switcher-toolbar
 * @ai-summary Renders the user-configurable preview view buttons (Web,
 *   Admin, … plus a "+") that sit above the preview iframe in both
 *   PreviewModal and VibePage. Per-repo localStorage; defaults to Web/
 *   /admin so existing repos look the same. Add-form is inline & tiny.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "../utils";
import {
  addPreviewView,
  readPreviewViews,
  removePreviewView,
  writePreviewViews,
  type PreviewView,
} from "../preview-views";

interface PreviewViewsBarProps {
  owner: string;
  repo: string;
  /** Currently selected view id. Falls back to the first view if missing. */
  selectedId: string | null;
  onSelect: (view: PreviewView) => void;
}

export function PreviewViewsBar({
  owner,
  repo,
  selectedId,
  onSelect,
}: PreviewViewsBarProps) {
  // Hydrate from localStorage on mount. SSR-safe: starts with defaults so
  // the first render matches the server, then settles to the user's list.
  const [views, setViews] = useState<PreviewView[]>(() =>
    readPreviewViews(owner, repo),
  );
  const [addOpen, setAddOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [pathDraft, setPathDraft] = useState("/");
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // Re-read when the repo changes (user switched contexts mid-session).
  useEffect(() => {
    setViews(readPreviewViews(owner, repo));
  }, [owner, repo]);

  // Auto-select the first view when the current selection vanishes
  // (e.g. user deleted it).
  useEffect(() => {
    if (!selectedId && views.length > 0) onSelect(views[0]!);
    else if (selectedId && !views.find((v) => v.id === selectedId)) {
      if (views.length > 0) onSelect(views[0]!);
    }
  }, [selectedId, views, onSelect]);

  useEffect(() => {
    if (addOpen) nameInputRef.current?.focus();
  }, [addOpen]);

  const persist = (next: PreviewView[]): void => {
    setViews(next);
    writePreviewViews(owner, repo, next);
  };

  const handleAdd = (): void => {
    const name = nameDraft.trim();
    if (!name) return;
    const next = addPreviewView(views, name, pathDraft);
    persist(next);
    onSelect(next[next.length - 1]!);
    setNameDraft("");
    setPathDraft("/");
    setAddOpen(false);
  };

  const handleRemove = (id: string): void => {
    if (views.length <= 1) return; // keep at least one — the iframe needs a path
    persist(removePreviewView(views, id));
  };

  return (
    <div className="flex items-center gap-1" role="tablist" aria-label="Preview view">
      {views.map((view) => {
        const selected = selectedId === view.id;
        return (
          <div key={view.id} className="group relative inline-flex">
            <button
              type="button"
              onClick={() => onSelect(view)}
              role="tab"
              aria-selected={selected}
              title={`${view.name} — ${view.path}`}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                selected
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-800 border border-transparent",
              )}
            >
              {view.name}
            </button>
            {/* Remove on hover — only available when more than one view
                exists, so the toolbar always has at least one entry. */}
            {views.length > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove(view.id);
                }}
                title={`Remove ${view.name}`}
                aria-label={`Remove ${view.name}`}
                className="hidden group-hover:flex absolute -top-1 -right-1 w-4 h-4 items-center justify-center rounded-full bg-zinc-900 border border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-500/40"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        );
      })}

      {addOpen ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAdd();
          }}
          className="flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded-md bg-zinc-800 border border-zinc-700"
        >
          <input
            ref={nameInputRef}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder="Name"
            maxLength={32}
            className="w-20 bg-transparent text-xs text-white placeholder-zinc-500 focus:outline-none"
          />
          <input
            value={pathDraft}
            onChange={(e) => setPathDraft(e.target.value)}
            placeholder="/path"
            maxLength={120}
            className="w-24 bg-transparent text-xs text-white placeholder-zinc-500 focus:outline-none"
          />
          <button
            type="submit"
            className="text-xs text-emerald-400 hover:text-emerald-300 px-1"
            title="Add view"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setAddOpen(false);
              setNameDraft("");
              setPathDraft("/");
            }}
            className="text-xs text-zinc-500 hover:text-zinc-300 px-1"
            title="Cancel"
          >
            <X className="w-3 h-3" />
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          title="Add a preview view"
          aria-label="Add a preview view"
          className="ml-1 px-1.5 py-1 text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-md border border-transparent"
        >
          <Plus className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
