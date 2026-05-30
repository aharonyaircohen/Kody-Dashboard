/**
 * @fileType component
 * @domain preview
 * @pattern view-switcher-dropdown
 * @ai-summary Single-button dropdown for the user-configurable preview
 *   views (Web, Admin, + any the user adds). Replaces the prior bar of
 *   inline buttons that crowded the toolbar. Click the active-view button
 *   to open the picker; each row has a delete-on-hover; the bottom row
 *   is an inline "+ Add" form (name + relative path).
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X, ChevronDown, Check } from "lucide-react";
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
  selectedId: string | null;
  onSelect: (view: PreviewView) => void;
}

export function PreviewViewsBar({
  owner,
  repo,
  selectedId,
  onSelect,
}: PreviewViewsBarProps) {
  const [views, setViews] = useState<PreviewView[]>(() =>
    readPreviewViews(owner, repo),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [pathDraft, setPathDraft] = useState("/");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setViews(readPreviewViews(owner, repo));
  }, [owner, repo]);

  // Auto-select first when current selection vanishes.
  useEffect(() => {
    if (!selectedId && views.length > 0) onSelect(views[0]!);
    else if (selectedId && !views.find((v) => v.id === selectedId)) {
      if (views.length > 0) onSelect(views[0]!);
    }
  }, [selectedId, views, onSelect]);

  // Close popover on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (e.target instanceof Node && rootRef.current.contains(e.target))
        return;
      setMenuOpen(false);
      setAddOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setAddOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (addOpen) nameInputRef.current?.focus();
  }, [addOpen]);

  const active =
    views.find((v) => v.id === selectedId) ?? views[0] ?? null;

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
    if (views.length <= 1) return;
    persist(removePreviewView(views, id));
  };

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        title="Switch preview view"
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/25 transition-colors"
      >
        <span className="truncate max-w-[8rem]">
          {active ? active.name : "View"}
        </span>
        <ChevronDown className="w-3 h-3" />
      </button>

      {menuOpen && (
        <div
          role="listbox"
          aria-label="Preview views"
          className="absolute top-full left-0 mt-1 z-50 min-w-[14rem] rounded-md border border-zinc-700 bg-zinc-900 shadow-lg py-1"
        >
          {views.map((view) => {
            const selected = view.id === active?.id;
            return (
              <div
                key={view.id}
                role="option"
                aria-selected={selected}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(view);
                    setMenuOpen(false);
                  }
                }}
                className={cn(
                  "group flex items-center gap-2 px-2 py-1.5 mx-1 rounded text-xs cursor-pointer focus:outline-none focus:ring-1 focus:ring-emerald-500/40",
                  selected
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "text-zinc-300 hover:bg-zinc-800",
                )}
                onClick={() => {
                  onSelect(view);
                  setMenuOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "w-3 h-3 shrink-0",
                    selected ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="truncate font-medium">{view.name}</span>
                <span className="ml-auto truncate text-zinc-500 max-w-[6rem]">
                  {view.path}
                </span>
                {views.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemove(view.id);
                    }}
                    title={`Remove ${view.name}`}
                    aria-label={`Remove ${view.name}`}
                    className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}

          <div className="border-t border-zinc-800 mt-1 pt-1 px-1">
            {addOpen ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAdd();
                }}
                className="flex items-center gap-1 px-1 py-1"
              >
                <input
                  ref={nameInputRef}
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder="Name"
                  maxLength={32}
                  className="w-20 bg-zinc-800 text-xs text-white placeholder-zinc-500 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                />
                <input
                  value={pathDraft}
                  onChange={(e) => setPathDraft(e.target.value)}
                  placeholder="/path"
                  maxLength={120}
                  className="flex-1 bg-zinc-800 text-xs text-white placeholder-zinc-500 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
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
                className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 rounded"
              >
                <Plus className="w-3 h-3" />
                Add view
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
