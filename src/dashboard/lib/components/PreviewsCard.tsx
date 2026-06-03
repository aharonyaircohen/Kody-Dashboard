/**
 * @fileType component
 * @domain settings
 * @pattern previews-card
 *
 * Fly Runner → Previews card. Edits the per-repo preview machine knobs stored
 * at kody.config.json `fly.previews` (plain config, NOT secrets):
 *
 *   - VM size (CPUs + RAM) for each per-PR preview machine.
 *   - Sleep when idle (auto-suspend) — keep ON so idle previews cost ~$0.
 *   - Health check — OFF by default; a periodic ping keeps the machine awake
 *     and defeats auto-suspend (this was the bug that ran ~50 machines 24/7).
 *   - Expiry (TTL days) — auto-destroy previews older than N days. 0 = keep.
 *
 * Plus a "Sweep expired now" action → POST /api/kody/previews/sweep, which
 * destroys past-TTL apps immediately (the webhook also sweeps opportunistically
 * on each build).
 *
 * Visibility: rendered alongside the other Fly cards; the knobs only take
 * effect for repos with FLY_API_TOKEN in their vault.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Rocket, Trash2 } from "lucide-react";

import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";
import { Checkbox } from "@dashboard/ui/checkbox";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";

interface PreviewsCardProps {
  /** Authenticated request headers (x-kody-token / -owner / -repo). */
  headers: Record<string, string>;
  /** True only when FLY_API_TOKEN is configured in the repo vault. */
  flyTokenConfigured: boolean;
}

interface ResolvedPreviews {
  cpus: number;
  memoryMb: number;
  idleSuspend: boolean;
  healthCheck: boolean;
  ttlDays: number;
}

interface SweepResult {
  enabled: boolean;
  ttlDays: number;
  inspected: number;
  destroyed: string[];
  errored: string[];
}

export function PreviewsCard({
  headers,
  flyTokenConfigured,
}: PreviewsCardProps) {
  const hasAuth = Object.keys(headers).length > 0;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sweeping, setSweeping] = useState(false);

  // Form state — seeded from the resolved (defaults-applied) config.
  const [form, setForm] = useState<ResolvedPreviews | null>(null);
  const [saved, setSaved] = useState<ResolvedPreviews | null>(null);

  const load = useCallback(async () => {
    if (!hasAuth) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/kody/previews/config", { headers });
      if (!res.ok) {
        setForm(null);
        return;
      }
      const body = (await res.json()) as { resolved: ResolvedPreviews };
      setForm(body.resolved);
      setSaved(body.resolved);
    } catch {
      setForm(null);
    } finally {
      setLoading(false);
    }
  }, [headers, hasAuth]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty =
    form !== null &&
    saved !== null &&
    (form.cpus !== saved.cpus ||
      form.memoryMb !== saved.memoryMb ||
      form.idleSuspend !== saved.idleSuspend ||
      form.healthCheck !== saved.healthCheck ||
      form.ttlDays !== saved.ttlDays);

  function patch(next: Partial<ResolvedPreviews>) {
    setForm((prev) => (prev ? { ...prev, ...next } : prev));
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const res = await fetch("/api/kody/previews/config", {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ previews: form }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? `Save failed (HTTP ${res.status})`);
        return;
      }
      const body = (await res.json()) as { resolved: ResolvedPreviews };
      setForm(body.resolved);
      setSaved(body.resolved);
      toast.success("Preview settings saved");
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function sweepNow() {
    setSweeping(true);
    try {
      const res = await fetch("/api/kody/previews/sweep", {
        method: "POST",
        headers,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? `Sweep failed (HTTP ${res.status})`);
        return;
      }
      const body = (await res.json()) as SweepResult;
      if (!body.enabled) {
        toast.info("No expiry set — nothing to sweep. Set a TTL above first.");
      } else {
        toast.success(
          `Swept ${body.destroyed.length} expired preview${
            body.destroyed.length === 1 ? "" : "s"
          } (${body.inspected} checked).`,
        );
      }
    } catch (err) {
      toast.error(`Sweep failed: ${(err as Error).message}`);
    } finally {
      setSweeping(false);
    }
  }

  return (
    <Card className="border-white/[0.08] bg-white/[0.03]">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Rocket className="w-4 h-4 text-sky-400" />
          <h2 className="text-sm font-semibold">PR previews</h2>
          {loading && (
            <Loader2 className="w-3 h-3 animate-spin text-white/40 ml-1" />
          )}
        </div>
        <p className="text-xs text-white/50 -mt-2">
          Size + lifecycle for the per-PR preview machines. Stored in
          kody.config.json (not a secret).
        </p>

        {!flyTokenConfigured && (
          <p className="text-[11px] text-amber-300/80 italic">
            Add FLY_API_TOKEN to the repo Secrets vault for these to take
            effect.
          </p>
        )}

        {form && (
          <div className="space-y-4">
            {/* Size */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="prev-cpus" className="text-xs text-white/70">
                  CPUs (shared)
                </Label>
                <Input
                  id="prev-cpus"
                  type="number"
                  min={1}
                  max={16}
                  step={1}
                  value={form.cpus}
                  onChange={(e) => patch({ cpus: Number(e.target.value) })}
                  className="bg-black/30 border-white/10"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prev-mem" className="text-xs text-white/70">
                  RAM (MB)
                </Label>
                <Input
                  id="prev-mem"
                  type="number"
                  min={256}
                  max={32768}
                  step={256}
                  value={form.memoryMb}
                  onChange={(e) => patch({ memoryMb: Number(e.target.value) })}
                  className="bg-black/30 border-white/10"
                />
              </div>
            </div>
            <p className="text-[11px] text-white/35 -mt-1">
              4096 MB suits dev-mode builds; prod builds run fine at 1024.
            </p>

            {/* Idle suspend */}
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <Checkbox
                checked={form.idleSuspend}
                onCheckedChange={(v) => patch({ idleSuspend: v === true })}
                className="mt-0.5"
              />
              <span className="text-xs text-white/60 leading-relaxed">
                Sleep when idle (auto-suspend)
                <span className="block text-[11px] text-white/35">
                  Recommended ON — idle previews snapshot to disk (~$0) and wake
                  in ~1s on the next request.
                </span>
              </span>
            </label>

            {/* Health check */}
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <Checkbox
                checked={form.healthCheck}
                onCheckedChange={(v) => patch({ healthCheck: v === true })}
                className="mt-0.5"
              />
              <span className="text-xs text-white/60 leading-relaxed">
                Health check (ping the machine periodically)
                <span className="block text-[11px] text-amber-300/60">
                  Leave OFF — a periodic ping keeps the machine awake and
                  defeats auto-suspend.
                </span>
              </span>
            </label>

            {/* TTL */}
            <div className="space-y-1.5">
              <Label htmlFor="prev-ttl" className="text-xs text-white/70">
                Expiry (days)
              </Label>
              <Input
                id="prev-ttl"
                type="number"
                min={0}
                max={365}
                step={1}
                value={form.ttlDays}
                onChange={(e) => patch({ ttlDays: Number(e.target.value) })}
                className="bg-black/30 border-white/10 w-32"
              />
              <p className="text-[11px] text-white/35">
                Auto-destroy previews older than this. 0 = keep forever.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <Button size="sm" onClick={save} disabled={!dirty || saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={sweepNow}
                disabled={sweeping || !flyTokenConfigured}
                className="text-rose-300 hover:text-rose-200 ml-auto"
                title="Destroy preview apps past their expiry now"
              >
                <Trash2 className="w-3 h-3 mr-1" />
                {sweeping ? "Sweeping…" : "Sweep expired now"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
