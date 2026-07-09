/**
 * @fileType component
 * @domain settings
 * @pattern fly-machines-table
 *
 * The operator's primary Fly view on /runner: every kody-managed machine the
 * repo's token can see, grouped by feature (preview / runner / brain
 * / builder), with inline Suspend / Resume / Destroy. Config lives in the
 * settings cards below — this table is "what's running right now, act on it".
 *
 * Reads GET /api/kody/fly/machines; acts via POST /api/kody/fly/machines/action.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Pause,
  Play,
  Power,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";

import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";
import {
  batchSuspendRunning,
  countRunningInGroup,
} from "@dashboard/lib/infrastructure/server-machine-model";
import {
  FLY_FEATURE_TITLE,
  isServerProviderMachineRunning,
  type ServerProviderFeature,
  type ServerProviderInventory,
  type ServerProviderMachineRow,
} from "@dashboard/lib/infrastructure/server-machine-model";
import { ConfirmDialog } from "./ConfirmDialog";

interface FlyMachinesTableProps {
  headers: Record<string, string>;
  flyTokenConfigured: boolean;
}

// Display order + friendly group titles.
const FEATURE_ORDER: ServerProviderFeature[] = [
  "preview",
  "runner",
  "brain",
  "builder",
  "preview-base",
  "other",
];
// Preview apps are throwaway per-PR envs — "Destroy" should remove the whole
// app (URL + IPs), not just one machine. Long-lived service apps keep the app
// and only destroy the machine.
function destroysWholeApp(feature: ServerProviderFeature): boolean {
  return feature === "preview" || feature === "preview-base";
}

/** Absolute start time, e.g. "Jun 1, 14:30". Empty when unknown. */
function formatStarted(iso?: string): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Compact age since creation, e.g. "2d 4h", "3h 12m", "45m", "30s". */
function formatDuration(iso?: string, now: number = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  let s = Math.max(0, Math.floor((now - t) / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s - m * 60}s`;
}

function statePill(state: string): string {
  if (state === "started" || state === "running")
    return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (state === "suspended")
    return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  if (state === "stopped") return "bg-white/5 text-white/50 border-white/10";
  return "bg-white/5 text-white/40 border-white/10";
}

export function FlyMachinesTable({
  headers,
  flyTokenConfigured,
}: FlyMachinesTableProps) {
  const hasAuth = Object.keys(headers).length > 0;

  const [inv, setInv] = useState<ServerProviderInventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ServerProviderMachineRow | null>(null);
  const [busyFeature, setBusyFeature] = useState<ServerProviderFeature | null>(
    null,
  );
  const [confirmFeature, setConfirmFeature] =
    useState<ServerProviderFeature | null>(null);

  const refresh = useCallback(async () => {
    if (!hasAuth || !flyTokenConfigured) {
      setInv(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/kody/fly/machines", { headers });
      if (!res.ok) {
        setInv(null);
        return;
      }
      setInv((await res.json()) as ServerProviderInventory);
    } catch {
      setInv(null);
    } finally {
      setLoading(false);
    }
  }, [headers, hasAuth, flyTokenConfigured]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(
    row: ServerProviderMachineRow,
    action: "suspend" | "start" | "destroy" | "destroyApp",
  ) {
    setBusyId(row.machineId);
    try {
      const res = await fetch("/api/kody/fly/machines/action", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          app: row.app,
          machineId: row.machineId,
          action,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? `Action failed (HTTP ${res.status})`);
        return;
      }
      toast.success(
        action === "suspend"
          ? "Suspended"
          : action === "start"
            ? "Resumed"
            : "Destroyed",
      );
      await refresh();
    } catch (err) {
      toast.error(`Action failed: ${(err as Error).message}`);
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  }

  async function suspendGroup(feature: ServerProviderFeature) {
    const rows = (inv?.machines ?? []).filter((m) => m.feature === feature);
    setBusyFeature(feature);
    try {
      const { results, okCount, failCount } = await batchSuspendRunning(
        rows,
        async (row) => {
          const res = await fetch("/api/kody/fly/machines/action", {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({
              app: row.app,
              machineId: row.machineId,
              action: "suspend",
            }),
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as {
              error?: string;
            };
            throw new Error(body.error ?? `HTTP ${res.status}`);
          }
        },
      );
      if (failCount === 0) {
        toast.success(
          `Suspended ${okCount} machine(s) in ${FLY_FEATURE_TITLE[feature]}.`,
        );
      } else {
        const failedIds = results
          .filter((r) => !r.ok)
          .map((r) => r.machineId)
          .join(", ");
        toast.error(
          `Suspended ${okCount}, ${failCount} failed in ${FLY_FEATURE_TITLE[feature]}: ${failedIds}`,
        );
      }
      await refresh();
    } catch (err) {
      toast.error(`Suspend all failed: ${(err as Error).message}`);
    } finally {
      setBusyFeature(null);
      setConfirmFeature(null);
    }
  }

  const groups = FEATURE_ORDER.map((feature) => ({
    feature,
    rows: (inv?.machines ?? []).filter((m) => m.feature === feature),
  })).filter((g) => g.rows.length > 0);

  return (
    <Card className="border-white/[0.08] bg-white/[0.03]">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-sky-400" />
          <h2 className="text-sm font-semibold">Machines</h2>
          {inv && (
            <span className="text-[11px] text-white/45">
              {inv.running} running · {inv.total} total
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={refresh}
            disabled={loading || !flyTokenConfigured}
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
            Add FLY_API_TOKEN to the repo Secrets vault to list machines.
          </p>
        )}

        {flyTokenConfigured && inv && groups.length === 0 && !loading && (
          <p className="text-xs text-white/40">No machines found.</p>
        )}

        {groups.map(({ feature, rows }) => {
          const runningInGroup = countRunningInGroup(rows);
          const groupBusy = busyFeature === feature;
          return (
            <div key={feature} className="space-y-1">
              <div className="flex items-center gap-2 pt-1">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
                  {FLY_FEATURE_TITLE[feature]}
                </h3>
                <span className="text-[11px] text-white/25">{rows.length}</span>
                {runningInGroup > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={groupBusy}
                    onClick={() => setConfirmFeature(feature)}
                    className="ml-auto h-6 px-1.5 text-amber-300 hover:text-amber-200"
                    title="Suspend all running machines in this section"
                  >
                    {groupBusy ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <Power className="w-3 h-3 mr-1" />
                    )}
                    Suspend all
                  </Button>
                )}
              </div>
              <div className="divide-y divide-white/[0.06]">
                {rows.map((row) => {
                  const busy = groupBusy || busyId === row.machineId;
                  const running = isServerProviderMachineRunning(row.state);
                  return (
                    <div
                      key={row.machineId}
                      className="flex items-center gap-2 py-1.5 text-xs"
                    >
                      <span className="font-medium text-white/80 w-28 truncate">
                        {row.label}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded-full border text-[10px] ${statePill(
                          row.state,
                        )}`}
                      >
                        {row.state}
                      </span>
                      <span className="text-white/40 font-mono">
                        {row.sizeLabel}
                      </span>
                      <span
                        className="text-white/30 hidden sm:inline"
                        title="Start time"
                      >
                        {formatStarted(row.createdAt)}
                      </span>
                      <span
                        className="text-white/45 tabular-nums"
                        title="Age since created"
                      >
                        age {formatDuration(row.createdAt)}
                      </span>
                      <div className="ml-auto flex items-center gap-1">
                        {running ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => act(row, "suspend")}
                            className="h-6 px-1.5 text-amber-300 hover:text-amber-200"
                            title="Suspend (snapshot, ~$0)"
                          >
                            <Pause className="w-3 h-3" />
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => act(row, "start")}
                            className="h-6 px-1.5 text-emerald-300 hover:text-emerald-200"
                            title="Resume"
                          >
                            <Play className="w-3 h-3" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setConfirm(row)}
                          className="h-6 px-1.5 text-rose-300 hover:text-rose-200"
                          title="Destroy"
                        >
                          {busy ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Trash2 className="w-3 h-3" />
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </CardContent>

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm && destroysWholeApp(confirm.feature)
            ? `Destroy preview ${confirm.label}?`
            : `Destroy ${confirm?.label ?? "machine"}?`
        }
        description={
          confirm && destroysWholeApp(confirm.feature)
            ? "Tears down the whole preview app (URL + IPs). It rebuilds on the next PR sync."
            : "Destroys this machine. Long-lived apps re-provision on next use."
        }
        confirmLabel="Destroy"
        variant="destructive"
        onConfirm={() =>
          confirm &&
          act(
            confirm,
            destroysWholeApp(confirm.feature) ? "destroyApp" : "destroy",
          )
        }
        onClose={() => setConfirm(null)}
      />

      <ConfirmDialog
        open={confirmFeature !== null}
        title={
          confirmFeature
            ? `Suspend all in ${FLY_FEATURE_TITLE[confirmFeature]}?`
            : "Suspend all?"
        }
        description={
          confirmFeature
            ? `Suspends ${countRunningInGroup(
                (inv?.machines ?? []).filter(
                  (m) => m.feature === confirmFeature,
                ),
              )} running machine(s) in ${FLY_FEATURE_TITLE[confirmFeature]}. Already-suspended machines are skipped.`
            : ""
        }
        confirmLabel="Suspend all"
        onConfirm={() => confirmFeature && suspendGroup(confirmFeature)}
        onClose={() => setConfirmFeature(null)}
      />
    </Card>
  );
}
