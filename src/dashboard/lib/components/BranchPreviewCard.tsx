/**
 * @fileType component
 * @domain previews
 * @pattern branch-preview-card
 *
 * Runner → "Branch previews" card. Spins up a Fly preview from any bare
 * branch (e.g. `dev`) — the PR-less counterpart to the automatic per-PR
 * previews. Because no PR-close webhook tears these down, this card is also
 * the leak-visibility surface: it lists every tracked branch preview with a
 * live status pill, an Open link, and a Destroy button.
 *
 * Repo + auth come from the connected-repo headers (same gate as the other
 * runner cards). Hidden entirely until FLY_API_TOKEN is configured.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ExternalLink,
  GitBranch,
  Info,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";
import { Input } from "@dashboard/ui/input";
import { SimpleTooltip } from "./SimpleTooltip";

interface BranchPreviewCardProps {
  /** Authenticated request headers (x-kody-token / -owner / -repo). */
  headers: Record<string, string>;
  /** True only when FLY_API_TOKEN is configured in the repo vault. */
  flyTokenConfigured: boolean;
}

type PreviewState =
  | "building"
  | "failed"
  | "pending"
  | "starting"
  | "running"
  | "unknown";

interface BranchPreview {
  branch: string;
  state: PreviewState;
  url: string | null;
}

interface ListResponse {
  previews?: Array<{
    branch: string;
    state?: PreviewState;
    url?: string | null;
  }>;
}

function pillClasses(state: PreviewState): string {
  switch (state) {
    case "running":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "starting":
      return "bg-sky-500/15 text-sky-300 border-sky-500/30";
    case "building":
    case "pending":
      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "failed":
      return "bg-rose-500/15 text-rose-300 border-rose-500/30";
    default:
      return "bg-white/5 text-white/40 border-white/10";
  }
}

function pillLabel(state: PreviewState): string {
  switch (state) {
    case "running":
      return "Running";
    case "starting":
      return "Starting";
    case "building":
    case "pending":
      return "Building";
    case "failed":
      return "Failed";
    default:
      return "Unknown";
  }
}

export function BranchPreviewCard({
  headers,
  flyTokenConfigured,
}: BranchPreviewCardProps) {
  const [previews, setPreviews] = useState<BranchPreview[]>([]);
  const [branch, setBranch] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [destroying, setDestroying] = useState<string | null>(null);

  const hasAuth = Object.keys(headers).length > 0;

  const refresh = useCallback(async () => {
    if (!flyTokenConfigured || !hasAuth) {
      setPreviews([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/kody/previews/branch", { headers });
      if (!res.ok) {
        setPreviews([]);
        return;
      }
      const body = (await res.json()) as ListResponse;
      setPreviews(
        (body.previews ?? []).map((p) => ({
          branch: p.branch,
          state: p.state ?? "unknown",
          url: p.url ?? null,
        })),
      );
    } catch {
      setPreviews([]);
    } finally {
      setLoading(false);
    }
    // headers is a fresh object each render; depend on its values, not identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTokenConfigured, hasAuth]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function create() {
    const name = branch.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await fetch("/api/kody/previews/branch", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ branch: name }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        const msg =
          body.error === "branch_not_found"
            ? `Branch "${name}" not found`
            : (body.message ?? body.error ?? `Failed (${res.status})`);
        throw new Error(msg);
      }
      setBranch("");
      toast.success(`Building preview for "${name}" — ready in ~2-5 min`);
      void refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create branch preview",
      );
    } finally {
      setCreating(false);
    }
  }

  async function destroy(name: string) {
    setDestroying(name);
    try {
      const res = await fetch("/api/kody/previews/branch", {
        method: "DELETE",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ branch: name }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(body.message ?? `Failed (${res.status})`);
      }
      toast.success(`Destroyed preview for "${name}"`);
      void refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to destroy branch preview",
      );
    } finally {
      setDestroying(null);
    }
  }

  if (!flyTokenConfigured) return null;

  return (
    <Card className="border-white/[0.08] bg-white/[0.03]">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-sky-400" />
          <h2 className="text-sm font-semibold">Branch previews</h2>
          <SimpleTooltip
            content="Spin up a Fly preview from any branch — no PR needed. Builds from the branch's current HEAD; click again to rebuild. Destroy when done (these don't auto-tear-down like PR previews)."
            side="right"
          >
            <Info className="w-3.5 h-3.5 text-white/50 hover:text-white/80 cursor-help" />
          </SimpleTooltip>
          {loading && (
            <Loader2 className="w-3 h-3 animate-spin text-white/40 ml-1" />
          )}
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !creating) void create();
            }}
            placeholder="branch name (e.g. dev)"
            className="bg-black/30 border-white/10 h-8 text-sm"
            disabled={creating}
          />
          <Button
            size="sm"
            onClick={create}
            disabled={creating || branch.trim().length === 0}
            className="h-8 shrink-0"
          >
            {creating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            <span className="ml-1">Create</span>
          </Button>
        </div>

        {previews.length > 0 && (
          <div className="space-y-1.5 pt-1 border-t border-white/[0.06]">
            {previews.map((p) => (
              <div
                key={p.branch}
                className="flex items-center gap-2 py-1 text-xs"
              >
                <span className="font-mono text-white/80 truncate">
                  {p.branch}
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded-full border text-[10px] font-medium uppercase tracking-wide ${pillClasses(
                    p.state,
                  )}`}
                >
                  {pillLabel(p.state)}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  {p.url && (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 px-1.5"
                      title="Open preview"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open
                    </a>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => destroy(p.branch)}
                    disabled={destroying === p.branch}
                    className="h-6 px-1.5 text-rose-300/70 hover:text-rose-300"
                    title="Destroy preview"
                  >
                    {destroying === p.branch ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Trash2 className="w-3 h-3" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
