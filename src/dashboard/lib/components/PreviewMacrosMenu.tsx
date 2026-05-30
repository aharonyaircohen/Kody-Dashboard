/**
 * @fileType component
 * @domain preview
 * @pattern menu-dropdown
 * @ai-summary Saved-macro menu that lives in the inspector toolbar's
 *   Capture group. Lets the user name a freshly-recorded sequence, replay
 *   any saved macro via the inspector extension (preview_act through the
 *   picker hook), or send a macro to chat for the model to drive itself.
 *
 *   Stored in the repo at `.kody/macros.json` via /api/kody/macros, so
 *   macros sync across devices and the chat agent can manage them too.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ListVideo, X, Play, Send, Trash2 } from "lucide-react";
import { formatMacroForChat, type Macro } from "../macros";
import { useAuth, buildAuthHeaders } from "../auth-context";
import type { PreviewAction, PreviewActResult } from "../picker/protocol";
import { cn } from "../utils";

interface PreviewMacrosMenuProps {
  owner: string;
  repo: string;
  /** Newly-stopped recording awaiting a name. Cleared once handled. */
  pendingSteps: PreviewAction[] | null;
  /**
   * URL the preview was on when recording started. We prepend a navigate
   * step to the saved macro using its path — so replay reliably lands
   * on the recording's starting page before running the rest of the
   * steps. Without this, a macro recorded on /admin/users fails when
   * the user replays from /dashboard.
   */
  pendingStartUrl: string | null;
  onPendingHandled: () => void;
  /** Composer chip emitter — reused for "Send to chat". */
  onContext: (chip: { id: string; label: string; context: string }) => void;
  /** picker.act — fires a single PreviewAction in the preview frame. */
  act: (action: PreviewAction) => Promise<PreviewActResult>;
  pickerAvailable: boolean;
}

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function PreviewMacrosMenu({
  owner,
  repo,
  pendingSteps,
  pendingStartUrl,
  onPendingHandled,
  onContext,
  act,
  pickerAvailable,
}: PreviewMacrosMenuProps) {
  const { auth } = useAuth();
  const [macros, setMacros] = useState<Macro[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!owner || !repo) {
      setMacros([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/kody/macros", {
          headers: buildAuthHeaders(auth),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { macros?: Macro[] };
        if (!cancelled && Array.isArray(data.macros)) setMacros(data.macros);
      } catch {
        /* best-effort load */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [owner, repo, auth]);

  // When a pending recording arrives, auto-open the menu so the save form
  // is visible — the user just stopped recording, the next move is to name it.
  useEffect(() => {
    if (pendingSteps && pendingSteps.length > 0) {
      setMenuOpen(true);
      setTimeout(() => nameInputRef.current?.focus(), 0);
    }
  }, [pendingSteps]);

  // Close popover on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (e.target instanceof Node && rootRef.current.contains(e.target))
        return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const handleSaveRecording = async (): Promise<void> => {
    if (!pendingSteps || pendingSteps.length === 0) return;
    const name = nameDraft.trim();
    if (!name) {
      toast.error("Give the macro a name first");
      return;
    }
    // Prepend a same-origin navigate using the recording's starting
    // URL so replay always lands on the right page first. Strip the
    // origin — the extension blocks cross-origin navigate, and the
    // path is what's actually meaningful across PR previews / envs.
    let stepsWithStart: PreviewAction[] = pendingSteps;
    if (pendingStartUrl) {
      try {
        const u = new URL(pendingStartUrl);
        const path = `${u.pathname}${u.search}` || "/";
        // Only prepend if the first recorded step isn't already a
        // navigate to the same path (avoid duplicate nav).
        const first = pendingSteps[0];
        const alreadyNavigates =
          first?.op === "navigate" && first.url === path;
        if (!alreadyNavigates) {
          stepsWithStart = [
            { op: "navigate", url: path },
            ...pendingSteps,
          ];
        }
      } catch {
        /* invalid URL — fall through to the raw steps */
      }
    }
    setSaving(true);
    try {
      const res = await fetch("/api/kody/macros", {
        method: "POST",
        headers: {
          ...buildAuthHeaders(auth),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, steps: stepsWithStart }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        macros?: Macro[];
        message?: string;
      };
      if (!res.ok) {
        toast.error(data.message ?? "Failed to save macro");
        return;
      }
      if (Array.isArray(data.macros)) setMacros(data.macros);
      setNameDraft("");
      onPendingHandled();
      toast.success(`Saved macro "${name}"`);
    } finally {
      setSaving(false);
    }
  };

  const handleDiscardRecording = (): void => {
    setNameDraft("");
    onPendingHandled();
  };

  const handleReplay = async (macro: Macro): Promise<void> => {
    if (!pickerAvailable) {
      toast.error(
        "Inspector extension not installed — can't replay in the preview.",
      );
      return;
    }
    setReplayingId(macro.id);
    try {
      for (let i = 0; i < macro.steps.length; i++) {
        const step = macro.steps[i]!;
        const result = await act(step);
        if (!result.ok) {
          toast.error(
            `Macro "${macro.name}" failed at step ${i + 1}: ${result.error ?? "unknown error"}`,
          );
          return;
        }
      }
      toast.success(`Replayed "${macro.name}" (${macro.steps.length} steps)`);
    } finally {
      setReplayingId(null);
    }
  };

  const handleSendToChat = (macro: Macro): void => {
    onContext({
      id: newId(),
      label: `Macro · ${macro.name}`,
      context: formatMacroForChat(macro),
    });
    toast.success(`Sent macro "${macro.name}" to chat`);
    setMenuOpen(false);
  };

  const handleRemove = async (id: string): Promise<void> => {
    const prev = macros;
    setMacros((m) => m.filter((x) => x.id !== id)); // optimistic
    try {
      const res = await fetch(`/api/kody/macros?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: buildAuthHeaders(auth),
      });
      const data = (await res.json().catch(() => ({}))) as { macros?: Macro[] };
      if (!res.ok) {
        setMacros(prev); // rollback
        toast.error("Failed to delete macro");
        return;
      }
      if (Array.isArray(data.macros)) setMacros(data.macros);
    } catch {
      setMacros(prev);
      toast.error("Failed to delete macro");
    }
  };

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        title={
          macros.length > 0
            ? `${macros.length} saved macro${macros.length === 1 ? "" : "s"}`
            : "No saved macros yet — record one to start"
        }
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium px-2 py-1.5 rounded-md border transition-colors",
          macros.length > 0 || pendingSteps
            ? "text-blue-200 bg-blue-500/15 border-blue-400/40 hover:bg-blue-500/25"
            : "text-blue-300/80 hover:text-blue-200 hover:bg-blue-500/15 border-transparent",
        )}
      >
        <ListVideo className="w-3 h-3" />
        {macros.length > 0 && (
          <span className="tabular-nums">{macros.length}</span>
        )}
      </button>

      {menuOpen && (
        <div
          role="menu"
          aria-label="Saved macros"
          className="absolute top-full left-0 mt-1 z-50 min-w-[18rem] rounded-md border border-zinc-700 bg-zinc-900 shadow-lg py-1"
        >
          {/* Save-recording form, shown when a recording is pending. */}
          {pendingSteps && pendingSteps.length > 0 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSaveRecording();
              }}
              className="px-2 py-1.5 mx-1 mb-1 rounded bg-emerald-500/10 border border-emerald-500/30"
            >
              <div className="text-[11px] text-emerald-200 mb-1">
                Save recording — {pendingSteps.length} step
                {pendingSteps.length === 1 ? "" : "s"}
              </div>
              <div className="flex items-center gap-1">
                <input
                  ref={nameInputRef}
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder="Macro name"
                  maxLength={64}
                  className="flex-1 bg-zinc-900 text-xs text-white placeholder-zinc-500 rounded px-1.5 py-0.5 border border-zinc-700 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                />
                <button
                  type="submit"
                  disabled={saving}
                  className="text-xs text-emerald-400 hover:text-emerald-300 px-1 disabled:opacity-50"
                  title="Save"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={handleDiscardRecording}
                  className="text-xs text-zinc-500 hover:text-zinc-300 px-1"
                  title="Discard recording"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </form>
          )}

          {macros.length === 0 && !pendingSteps && (
            <div className="px-3 py-3 text-xs text-zinc-500 text-center">
              No macros yet. Click <Circle /> Record, click through the
              preview, then save.
            </div>
          )}

          {macros.map((macro) => {
            const replaying = replayingId === macro.id;
            return (
              <div
                key={macro.id}
                role="menuitem"
                className="group flex items-center gap-2 px-2 py-1.5 mx-1 rounded text-xs text-zinc-300 hover:bg-zinc-800"
              >
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{macro.name}</div>
                  <div className="text-zinc-500 text-[10px] truncate">
                    {macro.steps.length} step
                    {macro.steps.length === 1 ? "" : "s"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleReplay(macro)}
                  disabled={replaying || !pickerAvailable}
                  title="Replay in the preview"
                  aria-label={`Replay ${macro.name}`}
                  className="text-emerald-300 hover:text-emerald-200 disabled:opacity-40 disabled:cursor-not-allowed p-1"
                >
                  <Play className={cn("w-3 h-3", replaying && "animate-pulse")} />
                </button>
                <button
                  type="button"
                  onClick={() => handleSendToChat(macro)}
                  title="Send macro to chat (model will run each step)"
                  aria-label={`Send ${macro.name} to chat`}
                  className="text-blue-300 hover:text-blue-200 p-1"
                >
                  <Send className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleRemove(macro.id)}
                  title="Delete macro"
                  aria-label={`Delete ${macro.name}`}
                  className="text-zinc-500 hover:text-red-400 p-1 opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Circle() {
  return (
    <span className="inline-block w-2 h-2 rounded-full bg-blue-400 mx-0.5 align-middle" />
  );
}
