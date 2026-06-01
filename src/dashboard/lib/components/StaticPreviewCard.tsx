/**
 * @fileType component
 * @domain previews
 * @pattern static-preview-card
 *
 * Runner → "Upload a file" card. Hosts a single uploaded static file
 * (HTML, PDF, image…) as a Fly preview with no build — the file is injected
 * straight into a stock static-server machine, so it's live in seconds.
 *
 * The PR-less, repo-less counterpart to branch previews. Like those, nothing
 * auto-tears these down, so this card lists every tracked upload with a live
 * status pill, an Open link, and a Destroy button.
 *
 * Repo + auth come from the connected-repo headers. Hidden entirely until
 * FLY_API_TOKEN is configured.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  FileUp,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";

interface StaticPreviewCardProps {
  /** Authenticated request headers (x-kody-token / -owner / -repo). */
  headers: Record<string, string>;
  /** True only when FLY_API_TOKEN is configured in the repo vault. */
  flyTokenConfigured: boolean;
}

type PreviewState = "pending" | "starting" | "running" | "unknown";

interface StaticPreview {
  id: string;
  name: string;
  state: PreviewState;
  url: string | null;
}

interface ListResponse {
  previews?: Array<{
    id: string;
    name: string;
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
    case "pending":
      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
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
    case "pending":
      return "Booting";
    default:
      return "Unknown";
  }
}

export function StaticPreviewCard({
  headers,
  flyTokenConfigured,
}: StaticPreviewCardProps) {
  const [previews, setPreviews] = useState<StaticPreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [destroying, setDestroying] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasAuth = Object.keys(headers).length > 0;

  const refresh = useCallback(async () => {
    if (!flyTokenConfigured || !hasAuth) {
      setPreviews([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/kody/previews/static", { headers });
      if (!res.ok) {
        setPreviews([]);
        return;
      }
      const body = (await res.json()) as ListResponse;
      setPreviews(
        (body.previews ?? []).map((p) => ({
          id: p.id,
          name: p.name,
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

  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/kody/previews/static", {
        method: "POST",
        headers, // don't set content-type — the browser adds the multipart boundary
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(body.message ?? body.error ?? `Failed (${res.status})`);
      }
      toast.success(`Serving "${file.name}" — ready in a few seconds`);
      void refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to upload file",
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function destroy(id: string) {
    setDestroying(id);
    try {
      const res = await fetch("/api/kody/previews/static", {
        method: "DELETE",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Failed (${res.status})`);
      }
      toast.success("Destroyed preview");
      void refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to destroy preview",
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
          <FileUp className="w-4 h-4 text-sky-400" />
          <h2 className="text-sm font-semibold">Upload a file</h2>
          {loading && (
            <Loader2 className="w-3 h-3 animate-spin text-white/40 ml-1" />
          )}
        </div>
        <p className="text-xs text-white/50 -mt-2">
          Serve a single static file (HTML, PDF, image…) as a live preview — no
          build, no repo, ready in seconds. Up to 5 MB. Destroy when done (these
          don&apos;t auto-tear-down like PR previews).
        </p>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          <Button
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="h-8"
          >
            {uploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            <span className="ml-1">
              {uploading ? "Uploading…" : "Choose file"}
            </span>
          </Button>
        </div>

        {previews.length > 0 && (
          <div className="space-y-1.5 pt-1 border-t border-white/[0.06]">
            {previews.map((p) => (
              <div key={p.id} className="flex items-center gap-2 py-1 text-xs">
                <span className="font-mono text-white/80 truncate">
                  {p.name}
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
                    onClick={() => destroy(p.id)}
                    disabled={destroying === p.id}
                    className="h-6 px-1.5 text-rose-300/70 hover:text-rose-300"
                    title="Destroy preview"
                  >
                    {destroying === p.id ? (
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
