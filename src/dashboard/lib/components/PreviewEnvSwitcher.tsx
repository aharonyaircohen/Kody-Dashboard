/**
 * @fileType component
 * @domain preview
 * @pattern env-switcher-dropdown
 * @ai-summary Toolbar dropdown to switch between named preview environments
 *   (Production / Staging / Dev …) and manage the list (add / edit / remove).
 *   Mirrors PreviewViewsBar's popover, but the list is repo-shared state in
 *   state repo `dashboard.json`, so mutations route through the parent's `onSave`
 *   (which PUTs the config) instead of localStorage.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Check,
  Clock,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { cn } from "../utils";
import {
  daysUntilExpiry,
  removeEnvironment,
  updateEnvironment,
  type PreviewEnvironment,
} from "../preview-environments";
import { PreviewEnvForm } from "./PreviewEnvForm";

/** Compact expiry chip text + tone for an uploaded preview. */
function expiryChip(
  expiresAt: number,
  now: number,
): { text: string; className: string } {
  const days = daysUntilExpiry(expiresAt, now);
  if (days <= 0) return { text: "expired", className: "text-rose-400/80" };
  if (days === 1) return { text: "1d left", className: "text-amber-400/80" };
  if (days <= 2)
    return { text: `${days}d left`, className: "text-amber-400/80" };
  return { text: `${days}d left`, className: "text-zinc-500" };
}

interface PreviewEnvSwitcherProps {
  environments: PreviewEnvironment[];
  selectedId: string | null;
  onSelect: (env: PreviewEnvironment) => void;
  /** Persist the next list (parent PUTs state repo `dashboard.json`). */
  onSave: (next: PreviewEnvironment[]) => Promise<void>;
  /** Add an environment with label + url (parent persists + selects). */
  onAdd: (label: string, url: string) => Promise<void>;
  /** Upload file(s) → boot a static preview → add it as an environment. */
  onUpload: (files: File[]) => Promise<void>;
  /** Destroy the Fly app behind an uploaded environment, if it has one. */
  onRemoveStatic?: (staticId: string) => Promise<void>;
  /** Delete repo-backed view files behind uploaded view, if any. */
  onRemoveRepoView?: (repoViewPath: string) => Promise<void>;
  /** Push an uploaded environment's expiry out by another TTL. */
  onExtend?: (id: string) => Promise<void>;
  isSaving: boolean;
  variant?: "toolbar" | "address";
}

export function PreviewEnvSwitcher({
  environments,
  selectedId,
  onSelect,
  onSave,
  onAdd,
  onUpload,
  onRemoveStatic,
  onRemoveRepoView,
  onExtend,
  isSaving,
  variant = "toolbar",
}: PreviewEnvSwitcherProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [extendingId, setExtendingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const now = Date.now();

  const active =
    environments.find((e) => e.id === selectedId) ?? environments[0] ?? null;

  // Close popover on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (e.target instanceof Node && rootRef.current.contains(e.target))
        return;
      setMenuOpen(false);
      setAddOpen(false);
      setEditingId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setAddOpen(false);
        setEditingId(null);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const handleAdd = async (label: string, url: string): Promise<void> => {
    await onAdd(label, url);
    setAddOpen(false);
  };

  const handleEdit = async (
    id: string,
    label: string,
    url: string,
  ): Promise<void> => {
    await onSave(updateEnvironment(environments, id, { label, url }));
    setEditingId(null);
  };

  const handleRemove = async (id: string): Promise<void> => {
    const removed = environments.find((e) => e.id === id);
    const next = removeEnvironment(environments, id);
    await onSave(next);
    // If we removed the active one, fall back to the first remaining.
    if (id === active?.id && next[0]) onSelect(next[0]);
    // Uploaded environments own a Fly app — tear it down too (best-effort).
    if (removed?.staticId && onRemoveStatic) {
      await onRemoveStatic(removed.staticId);
    }
    if (removed?.repoViewPath && onRemoveRepoView) {
      await onRemoveRepoView(removed.repoViewPath);
    }
  };

  const handleUpload = async (files: File[]): Promise<void> => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      await onUpload(files);
      setMenuOpen(false);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleExtend = async (id: string): Promise<void> => {
    if (!onExtend) return;
    setExtendingId(id);
    try {
      await onExtend(id);
    } finally {
      setExtendingId(null);
    }
  };

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        title={
          active
            ? `Switch preview environment: ${active.label}`
            : "Switch preview environment"
        }
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium transition-colors",
          variant === "address"
            ? "h-7 w-7 justify-center rounded-sm text-zinc-500 hover:bg-zinc-800 hover:text-white"
            : "rounded-md border border-sky-500/20 bg-sky-500/15 px-2.5 py-1 text-sky-300 hover:bg-sky-500/25",
        )}
      >
        <span
          className={cn(
            "truncate",
            variant === "address" ? "sr-only" : "max-w-[10rem]",
          )}
        >
          {active ? active.label : "Environment"}
        </span>
        <ChevronDown
          className={cn(variant === "address" ? "h-4 w-4" : "h-3 w-3")}
        />
      </button>

      {menuOpen && (
        <div
          role="listbox"
          aria-label="Preview environments"
          className="absolute top-full left-0 mt-1 z-50 min-w-[18rem] rounded-md border border-zinc-700 bg-zinc-900 shadow-lg py-1"
        >
          {environments.map((env) => {
            const selected = env.id === active?.id;
            if (editingId === env.id) {
              return (
                <div
                  key={env.id}
                  className="px-3 py-2 border-b border-zinc-800"
                >
                  <PreviewEnvForm
                    initialLabel={env.label}
                    initialUrl={env.url}
                    submitLabel="Save"
                    isSaving={isSaving}
                    onSubmit={(label, url) => handleEdit(env.id, label, url)}
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              );
            }
            return (
              <div
                key={env.id}
                role="option"
                aria-selected={selected}
                className="group flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800/70"
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelect(env);
                    setMenuOpen(false);
                  }}
                  className="flex-1 min-w-0 flex items-center gap-2 text-left"
                >
                  <Check
                    className={cn(
                      "w-3.5 h-3.5 shrink-0",
                      selected ? "text-sky-400" : "text-transparent",
                    )}
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
                      <span className="truncate">{env.label}</span>
                      {typeof env.expiresAt === "number" && (
                        <span
                          className={cn(
                            "shrink-0 text-[10px] font-normal",
                            expiryChip(env.expiresAt, now).className,
                          )}
                        >
                          {expiryChip(env.expiresAt, now).text}
                        </span>
                      )}
                    </span>
                    <span className="block text-[11px] text-zinc-500 truncate">
                      {env.url}
                    </span>
                  </span>
                </button>
                {env.staticId && onExtend && (
                  <button
                    type="button"
                    onClick={() => handleExtend(env.id)}
                    disabled={extendingId === env.id}
                    title="Extend 7 days"
                    aria-label={`Extend ${env.label} by 7 days`}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-zinc-400 hover:text-emerald-300 hover:bg-zinc-700 transition"
                  >
                    {extendingId === env.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Clock className="w-3 h-3" />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setEditingId(env.id)}
                  title="Edit"
                  aria-label={`Edit ${env.label}`}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-700 transition"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => handleRemove(env.id)}
                  title="Remove"
                  aria-label={`Remove ${env.label}`}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-zinc-400 hover:text-red-400 hover:bg-zinc-700 transition"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          {addOpen ? (
            <div className="px-3 py-2 border-t border-zinc-800">
              <PreviewEnvForm
                isSaving={isSaving}
                onSubmit={handleAdd}
                onCancel={() => setAddOpen(false)}
              />
            </div>
          ) : (
            <div className="mt-1 flex items-stretch border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="flex-1 flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-zinc-800/70"
              >
                <Plus className="w-3.5 h-3.5" />
                Add environment
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) void handleUpload(files);
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="Upload static files to state views"
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-zinc-800/70 border-l border-zinc-800 disabled:opacity-60"
              >
                {uploading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5" />
                )}
                {uploading ? "Uploading…" : "Upload view files"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
