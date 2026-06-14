/**
 * @fileType component
 * @domain settings
 * @pattern previews-card
 *
 * Fly Runner → Previews card. Operator-facing settings for the throwaway site
 * Fly builds per PR, stored in kody.config.json `fly.previews` (plain config,
 * NOT secrets):
 *
 *   - Preview size — a Small / Standard / Large preset (raw CPU/RAM live under
 *     "Advanced" for power users; an off-preset value shows as "Custom").
 *   - Sleep when idle — keep ON so idle previews cost ~$0.
 *   - Delete previews after N days — auto-cleanup (default 14).
 *   - "Clean up now" — repair sleep/wake settings, sleep live previews, and
 *     destroy past-expiry previews immediately.
 *   - Advanced — exact CPU/RAM + manual branch previews (BranchPreviewCard).
 *
 * Health check is intentionally NOT exposed (footgun — pinging defeats
 * idle sleep); it stays OFF in code, settable only via kody.config.json.
 * The FLY_API_TOKEN gate is handled once by the page-level banner, so this
 * card no longer repeats its own "not configured" warning.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Globe,
  Info,
  Loader2,
  Trash2,
} from "lucide-react";

import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";
import { Checkbox } from "@dashboard/ui/checkbox";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";
import { BranchPreviewCard } from "./BranchPreviewCard";
import { SimpleTooltip } from "./SimpleTooltip";

interface PreviewsCardProps {
  headers: Record<string, string>;
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
  aligned?: string[];
  unchanged?: string[];
  skipped?: string[];
  slept?: string[];
  errored: string[];
}

// Named sizes hide the raw CPU/RAM numbers. Standard (2x / 2 GB) is the
// default because Fly suspend is supported/recommended at <= 2 GB; Large is
// still available for heavy dev-mode builds and cold-stops when idle.
type SizeKey = "small" | "standard" | "large" | "custom";
const SIZE_PRESETS: Record<
  Exclude<SizeKey, "custom">,
  { cpus: number; memoryMb: number; label: string; hint: string }
> = {
  small: { cpus: 1, memoryMb: 1024, label: "Small", hint: "shared 1× · 1 GB" },
  standard: {
    cpus: 2,
    memoryMb: 2048,
    label: "Standard",
    hint: "shared 2× · 2 GB",
  },
  large: {
    cpus: 2,
    memoryMb: 4096,
    label: "Large",
    hint: "shared 2× · 4 GB · stops when idle",
  },
};

function matchPreset(cpus: number, memoryMb: number): SizeKey {
  for (const key of ["small", "standard", "large"] as const) {
    const p = SIZE_PRESETS[key];
    if (p.cpus === cpus && p.memoryMb === memoryMb) return key;
  }
  return "custom";
}

export function PreviewsCard({
  headers,
  flyTokenConfigured,
}: PreviewsCardProps) {
  const hasAuth = Object.keys(headers).length > 0;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

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
      // Surface the raw inputs up front when the saved size is off-preset.
      if (
        matchPreset(body.resolved.cpus, body.resolved.memoryMb) === "custom"
      ) {
        setShowAdvanced(true);
      }
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
      form.ttlDays !== saved.ttlDays);

  const selectedSize: SizeKey = form
    ? matchPreset(form.cpus, form.memoryMb)
    : "standard";

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
        toast.error(body.error ?? `Cleanup failed (HTTP ${res.status})`);
        return;
      }
      const body = (await res.json()) as SweepResult;
      const aligned = body.aligned?.length ?? 0;
      const slept = body.slept?.length ?? 0;
      if (!body.enabled) {
        toast.info(
          "Set a delete-after value first, then this clears old ones.",
        );
      } else {
        toast.success(
          `Slept ${slept} preview machine${
            slept === 1 ? "" : "s"
          }; repaired ${aligned}; deleted ${body.destroyed.length} expired preview${
            body.destroyed.length === 1 ? "" : "s"
          } (${body.inspected} checked).`,
        );
      }
    } catch (err) {
      toast.error(`Cleanup failed: ${(err as Error).message}`);
    } finally {
      setSweeping(false);
    }
  }

  return (
    <Card className="border-white/[0.08] bg-white/[0.03]">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-sky-400" />
          <h2 className="text-sm font-semibold">PR previews</h2>
          <SimpleTooltip
            content="A throwaway site built for every pull request."
            side="right"
          >
            <Info className="w-3.5 h-3.5 text-white/50 hover:text-white/80 cursor-help" />
          </SimpleTooltip>
          <SimpleTooltip
            content="Applies to everyone using the repo."
            side="bottom"
          >
            <span className="ml-auto text-[10px] text-white/35 uppercase tracking-wide cursor-help">
              whole repo
            </span>
          </SimpleTooltip>
          {loading && (
            <Loader2 className="w-3 h-3 animate-spin text-white/40" />
          )}
        </div>

        {form && (
          <div className="space-y-4">
            {/* Size preset */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-white/70">Preview size</Label>
                <SimpleTooltip
                  content="Standard suspends when idle; Large is for heavy builds and stops when idle."
                  side="right"
                >
                  <Info className="w-3 h-3 text-white/50 hover:text-white/80 cursor-help" />
                </SimpleTooltip>
              </div>
              <div className="flex gap-1.5">
                {(["small", "standard", "large"] as const).map((key) => {
                  const p = SIZE_PRESETS[key];
                  const active = selectedSize === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        patch({ cpus: p.cpus, memoryMb: p.memoryMb })
                      }
                      className={`flex-1 rounded-md border px-2 py-1.5 text-xs transition ${
                        active
                          ? "border-sky-500/50 bg-sky-500/15 text-sky-200"
                          : "border-white/10 bg-black/20 text-white/60 hover:text-white/80"
                      }`}
                      title={p.hint}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sleep when idle */}
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <Checkbox
                checked={form.idleSuspend}
                onCheckedChange={(v) => patch({ idleSuspend: v === true })}
                className="mt-0.5"
              />
              <span className="text-xs text-white/60 leading-relaxed flex items-center gap-1.5">
                Sleep previews when idle
                <SimpleTooltip
                  content="Recommended — 2 GB previews suspend; larger previews stop and wake cold."
                  side="right"
                >
                  <Info className="w-3 h-3 text-white/50 hover:text-white/80 cursor-help" />
                </SimpleTooltip>
              </span>
            </label>

            {/* Delete after */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor="prev-ttl" className="text-xs text-white/70">
                  Delete previews after
                </Label>
                <SimpleTooltip
                  content="Old previews delete themselves after this. Default 14 (max 365)."
                  side="right"
                >
                  <Info className="w-3 h-3 text-white/50 hover:text-white/80 cursor-help" />
                </SimpleTooltip>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  id="prev-ttl"
                  type="number"
                  min={1}
                  max={365}
                  step={1}
                  value={form.ttlDays}
                  onChange={(e) => patch({ ttlDays: Number(e.target.value) })}
                  className="bg-black/30 border-white/10 w-24"
                />
                <span className="text-xs text-white/50">days</span>
              </div>
            </div>

            {/* Actions */}
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
                title="Sleep running previews, repair wake settings, and delete expired previews"
              >
                <Trash2 className="w-3 h-3 mr-1" />
                {sweeping ? "Cleaning…" : "Clean up now"}
              </Button>
            </div>

            {/* Advanced */}
            <div className="pt-1 border-t border-white/[0.06]">
              <button
                type="button"
                onClick={() => setShowAdvanced((s) => !s)}
                className="flex items-center gap-1 text-[11px] text-white/45 hover:text-white/70 pt-2"
              >
                {showAdvanced ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                Advanced
              </button>

              {showAdvanced && (
                <div className="space-y-4 pt-3">
                  {/* Exact size — overrides the preset */}
                  <div className="space-y-1.5">
                    <Label className="text-xs text-white/70">
                      Exact size (overrides the preset)
                    </Label>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label
                          htmlFor="prev-cpus"
                          className="text-[11px] text-white/45"
                        >
                          CPUs
                        </Label>
                        <Input
                          id="prev-cpus"
                          type="number"
                          min={1}
                          max={16}
                          step={1}
                          value={form.cpus}
                          onChange={(e) =>
                            patch({ cpus: Number(e.target.value) })
                          }
                          className="bg-black/30 border-white/10"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label
                          htmlFor="prev-mem"
                          className="text-[11px] text-white/45"
                        >
                          RAM (MB)
                        </Label>
                        <Input
                          id="prev-mem"
                          type="number"
                          min={256}
                          max={32768}
                          step={256}
                          value={form.memoryMb}
                          onChange={(e) =>
                            patch({ memoryMb: Number(e.target.value) })
                          }
                          className="bg-black/30 border-white/10"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Manual branch preview — kept visible so leaked, never-
                      expiring branch previews stay discoverable. */}
                  <BranchPreviewCard
                    headers={headers}
                    flyTokenConfigured={flyTokenConfigured}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
