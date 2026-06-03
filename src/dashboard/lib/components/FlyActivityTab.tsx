/**
 * @fileType component
 * @domain runner
 * @pattern fly-activity-tab
 *
 * The "Activity" tab body inside the Fly Runner page: per-machine working time,
 * uptime %, suspend count, and estimated cost over the retained window. Reads
 * GET /api/kody/fly/activity, which computes from snapshots recorded on the
 * `kody-state` branch (GitHub-only — no DB, no cron). Opening the tab records a
 * fresh snapshot, so history fills in as it's used.
 *
 * Content-only (no PageShell) so it slots into RunnerManager's Tabs alongside
 * Configuration + Machines. Takes the same `headers` / `flyTokenConfigured`
 * props as the other Fly cards.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";

interface FlyActivityTabProps {
  headers: Record<string, string>;
  flyTokenConfigured: boolean;
}

interface MachineActivity {
  app: string;
  machineId: string;
  feature: string;
  label: string;
  spanMs: number;
  runningMs: number;
  uptime: number;
  suspendCount: number;
  lastState: string;
  size: { cpuKind?: string; cpus?: number; memoryMb?: number };
  estCostUsd: number;
  samples: number;
}

interface ActivityResponse {
  activity: MachineActivity[];
  snapshots: number;
  now: number;
}

/** ms → "3d 4h" / "5h 12m" / "8m" — coarse, just enough to scan. */
function humanDuration(ms: number): string {
  if (ms <= 0) return "0m";
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mm}m`;
  return `${mm}m`;
}

function sizeLabel(size: MachineActivity["size"]): string {
  if (!size.cpus) return "—";
  const kind = size.cpuKind === "performance" ? "perf" : "shared";
  const gb =
    size.memoryMb && size.memoryMb >= 1024
      ? `${(size.memoryMb / 1024).toFixed(size.memoryMb % 1024 ? 1 : 0)} GB`
      : `${size.memoryMb ?? "?"} MB`;
  return `${kind} ${size.cpus}x · ${gb}`;
}

function stateColor(state: string): string {
  if (state === "started") return "text-emerald-300";
  if (state === "suspended") return "text-amber-300";
  if (state === "stopped" || state === "destroyed") return "text-rose-300";
  return "text-white/50";
}

export function FlyActivityTab({
  headers,
  flyTokenConfigured,
}: FlyActivityTabProps) {
  const hasAuth = Object.keys(headers).length > 0;
  const [rows, setRows] = useState<MachineActivity[] | null>(null);
  const [snapshots, setSnapshots] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!hasAuth) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/kody/fly/activity", { headers });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        setError(body.message ?? body.error ?? `HTTP ${res.status}`);
        setRows(null);
        return;
      }
      const body = (await res.json()) as ActivityResponse;
      setRows(body.activity);
      setSnapshots(body.snapshots);
    } catch (err) {
      setError((err as Error).message);
      setRows(null);
    } finally {
      setLoading(false);
    }
  }, [headers, hasAuth]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalCost = (rows ?? []).reduce((sum, r) => sum + r.estCostUsd, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-xs text-white/50">
          Computed from snapshots on the{" "}
          <span className="font-mono">kody-state</span> branch. Opening this tab
          records one — history fills in over time.
          {snapshots !== null ? ` ${snapshots} snapshots so far.` : ""}
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={load}
          disabled={loading || !hasAuth}
          className="ml-auto h-7 px-2 text-white/50 hover:text-white/80"
          title="Refresh"
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
        </Button>
      </div>

      {!flyTokenConfigured && (
        <p className="text-[11px] text-amber-300/80 italic">
          Add FLY_API_TOKEN to the repo Secrets vault to see machine activity.
        </p>
      )}

      {error && (
        <Card className="border-rose-500/20 bg-rose-500/[0.04]">
          <CardContent className="p-4 text-xs text-rose-300">
            {error}
          </CardContent>
        </Card>
      )}

      {rows && rows.length > 0 && (
        <Card className="border-white/[0.08] bg-white/[0.03]">
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-white/40 border-b border-white/[0.06]">
                  <th className="text-left font-medium p-3">Machine</th>
                  <th className="text-left font-medium p-3">Size</th>
                  <th className="text-left font-medium p-3">State</th>
                  <th className="text-right font-medium p-3">Working time</th>
                  <th className="text-right font-medium p-3">Uptime</th>
                  <th className="text-right font-medium p-3">Suspends</th>
                  <th className="text-right font-medium p-3">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={`${r.app}/${r.machineId}`}
                    className="border-b border-white/[0.04] hover:bg-white/[0.02]"
                  >
                    <td className="p-3">
                      <div className="text-white/80">{r.label}</div>
                      <div className="text-[10px] text-white/35 font-mono">
                        {r.feature} · {r.app}
                      </div>
                    </td>
                    <td className="p-3 text-white/60">{sizeLabel(r.size)}</td>
                    <td className={`p-3 ${stateColor(r.lastState)}`}>
                      {r.lastState}
                    </td>
                    <td className="p-3 text-right text-white/70">
                      {humanDuration(r.runningMs)}
                    </td>
                    <td className="p-3 text-right text-white/60">
                      {Math.round(r.uptime * 100)}%
                    </td>
                    <td className="p-3 text-right text-white/60">
                      {r.suspendCount}
                    </td>
                    <td className="p-3 text-right text-white/80 font-mono">
                      ${r.estCostUsd.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="text-white/50">
                  <td className="p-3" colSpan={6}>
                    Estimated total (observed window)
                  </td>
                  <td className="p-3 text-right font-mono text-white/80">
                    ${totalCost.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>
      )}

      {rows && rows.length === 0 && !error && (
        <p className="text-xs text-white/40 italic">
          No history yet. Snapshots accrue as machines run and this tab (or a
          preview build) records them.
        </p>
      )}

      <p className="text-[11px] text-white/30">
        Cost is an estimate from machine size × running time (Fly has no
        per-machine cost API), not a billing figure.
      </p>
    </div>
  );
}
