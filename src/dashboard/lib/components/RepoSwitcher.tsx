/**
 * @fileType component
 * @domain kody
 * @pattern repo-switcher-dropdown
 * @ai-summary Header dropdown that replaces the standalone /repos page. The
 *   current repo name in the top bar becomes a trigger: clicking it opens a
 *   popover listing every connected repo (switch via setCurrentRepo, which
 *   reloads), with a remove action per repo and an inline "Add repository"
 *   form (shared AddRepoForm). Mirrors PreviewEnvSwitcher's popover mechanics
 *   (outside-click / Escape to close). When no repo is connected yet there is
 *   nothing to switch, so it renders a plain title — first-run connect lives
 *   on the page (RepoManager).
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Star, Trash2 } from "lucide-react";
import { cn } from "../utils";
import { useAuth, type KodyRepoEntry } from "../auth-context";
import { AddRepoForm } from "./AddRepoForm";
import { ConfirmDialog } from "./ConfirmDialog";

export function RepoSwitcher() {
  const { auth, setCurrentRepo, removeRepo } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{
    index: number;
    entry: KodyRepoEntry;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close popover on outside click / Escape. Mirrors PreviewEnvSwitcher.
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

  // No repo connected yet → nothing to switch. First-run connect is the
  // page (RepoManager); the header just shows the brand name.
  if (!auth) {
    return (
      <h1 className="text-lg md:text-xl font-semibold text-foreground truncate">
        Kody Operations
      </h1>
    );
  }

  const current = auth.repos[auth.currentRepoIndex];
  const title = current ? current.repo : "Kody Operations";

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        title="Switch repository"
        className="group inline-flex items-center gap-1.5 min-w-0 rounded-md px-1.5 -mx-1.5 py-0.5 hover:bg-white/[0.06] transition-colors"
      >
        <span className="text-lg md:text-xl font-semibold text-foreground truncate">
          {title}
        </span>
        <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
      </button>

      {menuOpen && (
        <div
          role="listbox"
          aria-label="Connected repositories"
          className="absolute top-full left-0 mt-1.5 z-50 min-w-[20rem] max-w-[24rem] max-h-[75vh] overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 shadow-lg py-1"
        >
          {auth.repos.map((entry, idx) => {
            const selected = idx === auth.currentRepoIndex;
            return (
              <div
                key={`${entry.owner}/${entry.repo}`}
                role="option"
                aria-selected={selected}
                className="group flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800/70"
              >
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    // No-op + reload happens inside setCurrentRepo when the
                    // index actually changes; clicking the current one closes.
                    setCurrentRepo(idx);
                  }}
                  className="flex-1 min-w-0 flex items-center gap-2 text-left"
                >
                  <Check
                    className={cn(
                      "w-3.5 h-3.5 shrink-0",
                      selected ? "text-emerald-400" : "text-transparent",
                    )}
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
                      <span className="truncate">
                        {entry.owner}/{entry.repo}
                      </span>
                      {entry.isLogin && (
                        <Star
                          className="w-3 h-3 shrink-0 text-zinc-500"
                          aria-label="Login repo"
                        />
                      )}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRemove({ index: idx, entry })}
                  disabled={entry.isLogin}
                  title={
                    entry.isLogin
                      ? "Login repo can't be removed — use Logout instead"
                      : "Remove repository"
                  }
                  aria-label={`Remove ${entry.owner}/${entry.repo}`}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-zinc-400 hover:text-red-400 hover:bg-zinc-700 transition disabled:opacity-0 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          {addOpen ? (
            <div className="px-3 py-2 mt-1 border-t border-zinc-800">
              <AddRepoForm
                isBootstrap={false}
                onAdded={() => {
                  setAddOpen(false);
                  setMenuOpen(false);
                }}
              />
            </div>
          ) : (
            <div className="mt-1 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-zinc-800/70"
              >
                <Plus className="w-3.5 h-3.5" />
                Add repository
              </button>
            </div>
          )}
        </div>
      )}

      {confirmRemove && (
        <ConfirmDialog
          open
          onClose={() => setConfirmRemove(null)}
          title={`Remove ${confirmRemove.entry.owner}/${confirmRemove.entry.repo}?`}
          description="The PAT will be deleted from this browser. The repository and webhook on GitHub are not affected."
          confirmLabel="Remove"
          variant="destructive"
          onConfirm={() => {
            const { index } = confirmRemove;
            removeRepo(index);
          }}
        />
      )}
    </div>
  );
}
