/**
 * @fileType component
 * @domain kody
 * @pattern repo-switcher-dropdown
 * @ai-summary Header dropdown replaces standalone /repos page. The
 * active repo remains the selected runtime context, while connected repos
 * are grouped by GitHub owner with a Manage org link for each group.
 */
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Building2,
  Check,
  ChevronDown,
  ExternalLink,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { cn } from "../utils";
import { useAuth, type KodyRepoEntry } from "../auth-context";
import { AddRepoForm } from "./AddRepoForm";
import { ConfirmDialog } from "./ConfirmDialog";

interface RepoGroup {
  owner: string;
  repos: Array<{ entry: KodyRepoEntry; index: number }>;
}

function groupReposByOwner(repos: KodyRepoEntry[]): RepoGroup[] {
  const groups = new Map<string, RepoGroup>();
  repos.forEach((entry, index) => {
    const group = groups.get(entry.owner);
    if (group) {
      group.repos.push({ entry, index });
      return;
    }
    groups.set(entry.owner, {
      owner: entry.owner,
      repos: [{ entry, index }],
    });
  });
  return Array.from(groups.values());
}

export function RepoSwitcher() {
  const { auth, setCurrentRepo, removeRepo } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{
    index: number;
    entry: KodyRepoEntry;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

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

  if (!auth) {
    return (
      <h1 className="text-lg md:text-xl font-semibold text-foreground truncate">
        Kody Operations
      </h1>
    );
  }

  const current = auth.repos[auth.currentRepoIndex];
  const title = current ? current.repo : "Kody Operations";
  const repoGroups = groupReposByOwner(auth.repos);

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
          {repoGroups.map((group) => (
            <div
              key={group.owner}
              role="group"
              aria-label={`${group.owner} repositories`}
              className="py-1"
            >
              <div className="flex items-center justify-between gap-2 px-3 py-1">
                <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  {group.owner}
                </span>
                <Link
                  href={`/org/${encodeURIComponent(group.owner)}`}
                  onClick={() => {
                    setMenuOpen(false);
                    setAddOpen(false);
                  }}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-emerald-300 hover:bg-zinc-800 hover:text-emerald-200"
                >
                  <Building2 className="h-3 w-3" />
                  Manage org
                </Link>
              </div>

              {group.repos.map(({ entry, index }) => {
                const selected = index === auth.currentRepoIndex;
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
                        setCurrentRepo(index);
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
                        <span className="flex items-center gap-1.5 text-sm font-medium text-zinc-200">
                          <span className="truncate">{entry.repo}</span>
                          {entry.isLogin && (
                            <Star
                              className="w-3 h-3 shrink-0 text-zinc-500"
                              aria-label="Login repo"
                            />
                          )}
                        </span>
                      </span>
                    </button>
                    <a
                      href={
                        entry.repoUrl ||
                        `https://github.com/${entry.owner}/${entry.repo}`
                      }
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title="Open on GitHub"
                      aria-label={`Open ${entry.owner}/${entry.repo} on GitHub`}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 transition"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => setConfirmRemove({ index, entry })}
                      disabled={entry.isLogin}
                      title={
                        entry.isLogin
                          ? "Login repo can't be removed — use Logout instead"
                          : "Remove repository"
                      }
                      aria-label={`Remove ${entry.owner}/${entry.repo}`}
                      className="p-1 rounded text-zinc-400 hover:text-red-400 hover:bg-zinc-700 transition md:opacity-0 md:group-hover:opacity-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}

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
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-emerald-300 hover:bg-zinc-800/70"
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
          description="The PAT will be deleted from this browser. Repository and webhook on GitHub are not affected."
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
