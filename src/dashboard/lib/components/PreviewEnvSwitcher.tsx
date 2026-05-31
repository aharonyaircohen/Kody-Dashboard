/**
 * @fileType component
 * @domain preview
 * @pattern env-switcher-dropdown
 * @ai-summary Toolbar dropdown to switch between named preview environments
 *   (Production / Staging / Dev …) and manage the list (add / edit / remove).
 *   Mirrors PreviewViewsBar's popover, but the list is repo-shared state in
 *   `.kody/dashboard.json`, so mutations route through the parent's `onSave`
 *   (which PUTs the config) instead of localStorage.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "../utils";
import {
  addEnvironment,
  removeEnvironment,
  updateEnvironment,
  type PreviewEnvironment,
} from "../preview-environments";
import { PreviewEnvForm } from "./PreviewEnvForm";

interface PreviewEnvSwitcherProps {
  environments: PreviewEnvironment[];
  selectedId: string | null;
  onSelect: (env: PreviewEnvironment) => void;
  /** Persist the next list (parent PUTs `.kody/dashboard.json`). */
  onSave: (next: PreviewEnvironment[]) => Promise<void>;
  isSaving: boolean;
}

export function PreviewEnvSwitcher({
  environments,
  selectedId,
  onSelect,
  onSave,
  isSaving,
}: PreviewEnvSwitcherProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const active =
    environments.find((e) => e.id === selectedId) ?? environments[0] ?? null;

  // Close popover on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (e.target instanceof Node && rootRef.current.contains(e.target)) return;
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
    const next = addEnvironment(environments, label, url);
    await onSave(next);
    const created = next[next.length - 1];
    if (created) onSelect(created);
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
    const next = removeEnvironment(environments, id);
    await onSave(next);
    // If we removed the active one, fall back to the first remaining.
    if (id === active?.id && next[0]) onSelect(next[0]);
  };

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        title="Switch preview environment"
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-sky-500/15 text-sky-300 border border-sky-500/20 hover:bg-sky-500/25 transition-colors"
      >
        <span className="truncate max-w-[10rem]">
          {active ? active.label : "Environment"}
        </span>
        <ChevronDown className="w-3 h-3" />
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
                <div key={env.id} className="px-3 py-2 border-b border-zinc-800">
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
                    <span className="block text-xs font-medium text-zinc-200 truncate">
                      {env.label}
                    </span>
                    <span className="block text-[11px] text-zinc-500 truncate">
                      {env.url}
                    </span>
                  </span>
                </button>
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
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="mt-1 w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-zinc-800/70 border-t border-zinc-800"
            >
              <Plus className="w-3.5 h-3.5" />
              Add environment
            </button>
          )}
        </div>
      )}
    </div>
  );
}
