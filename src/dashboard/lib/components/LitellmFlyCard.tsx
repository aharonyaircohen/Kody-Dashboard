/**
 * @fileType component
 * @domain settings
 * @pattern litellm-fly-card
 *
 * Settings → LiteLLM proxy card. Read-only window onto the shared always-on
 * LiteLLM Fly app (`kody-litellm`) that every Fly runner points at to skip
 * the ~24s LiteLLM cold-start.
 *
 *   - Status pill: Off (not deployed) / Running / Suspended / Stopped.
 *   - Refresh → re-fetch GET /api/kody/litellm/status.
 *
 * No turn-on/off here on purpose: the app is deployed out-of-band via
 * `fly deploy` in kody2/litellm-server. This card answers the one question
 * the dashboard previously assumed — "is it actually up?" — rather than
 * managing its lifecycle.
 *
 * Visibility: rendered only when the connected repo has FLY_API_TOKEN in its
 * vault (same gate as the Brain card). Without Fly configured there is
 * nothing to show — GitHub Actions is the default/fallback path.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Server } from "lucide-react";

import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";

export type LitellmFlyState =
  | "off"
  | "running"
  | "suspended"
  | "stopped"
  | "unknown";

interface LitellmFlyCardProps {
  /** Authenticated request headers (x-kody-token / -owner / -repo). */
  headers: Record<string, string>;
  /** True only when FLY_API_TOKEN is configured in the repo vault. */
  flyTokenConfigured: boolean;
}

interface StatusResponse {
  state?: LitellmFlyState;
  app?: string;
  machineCount?: number;
  error?: string;
}

interface PoolStatus {
  min: number;
  free: number;
  booting: number;
  claimsInFlight: number;
  total: number;
}

function pillClasses(state: LitellmFlyState): string {
  switch (state) {
    case "running":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "suspended":
      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    case "stopped":
      return "bg-rose-500/15 text-rose-300 border-rose-500/30";
    case "off":
      return "bg-white/5 text-white/60 border-white/10";
    default:
      return "bg-white/5 text-white/40 border-white/10";
  }
}

function pillLabel(state: LitellmFlyState): string {
  switch (state) {
    case "off":
      return "Not deployed";
    case "running":
      return "Running";
    case "suspended":
      return "Suspended";
    case "stopped":
      return "Stopped";
    default:
      return "Unknown";
  }
}

export function LitellmFlyCard({
  headers,
  flyTokenConfigured,
}: LitellmFlyCardProps) {
  const [state, setState] = useState<LitellmFlyState>("unknown");
  const [app, setApp] = useState<string | null>(null);
  const [machineCount, setMachineCount] = useState<number | null>(null);
  const [pool, setPool] = useState<PoolStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!flyTokenConfigured || Object.keys(headers).length === 0) {
      setState("off");
      setApp(null);
      setMachineCount(null);
      setPool(null);
      return;
    }
    setLoading(true);
    try {
      const [statusRes, poolRes] = await Promise.all([
        fetch("/api/kody/litellm/status", { headers }),
        fetch("/api/kody/pool/status", { headers }),
      ]);
      if (!statusRes.ok) {
        setState("unknown");
      } else {
        const body = (await statusRes.json()) as StatusResponse;
        setState(body.state ?? "unknown");
        setApp(body.app ?? null);
        setMachineCount(body.machineCount ?? null);
      }
      if (poolRes.ok) {
        const body = (await poolRes.json()) as { status: PoolStatus | null };
        setPool(body.status ?? null);
      } else {
        setPool(null);
      }
    } catch {
      setState("unknown");
    } finally {
      setLoading(false);
    }
  }, [headers, flyTokenConfigured]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Card className="border-white/[0.08] bg-white/[0.03]">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-sky-400" />
          <h2 className="text-sm font-semibold">LiteLLM proxy</h2>
          <span
            className={`ml-2 px-2 py-0.5 rounded-full border text-[10px] font-medium uppercase tracking-wide ${pillClasses(
              state,
            )}`}
          >
            {pillLabel(state)}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={refresh}
            disabled={loading || !flyTokenConfigured}
            className="ml-auto h-7 px-2 text-white/50 hover:text-white/80"
            title="Refresh status"
          >
            {loading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
          </Button>
        </div>
        <p className="text-xs text-white/50 -mt-2">
          Shared always-on proxy your Fly runners point at to skip the ~24s
          LiteLLM cold-start. Deployed from{" "}
          <span className="font-mono">kody2/litellm-server</span> via{" "}
          <span className="font-mono">fly deploy</span> — this card is
          read-only.
        </p>
        {!flyTokenConfigured && (
          <p className="text-[11px] text-amber-300/80 italic">
            Add FLY_API_TOKEN to the repo Secrets vault to enable. Without Fly,
            tasks run on GitHub Actions.
          </p>
        )}
        {flyTokenConfigured && state === "off" && (
          <p className="text-[11px] text-amber-300/80 italic">
            App not found on your Fly org. Runs fall back to a per-session
            LiteLLM start (~24s slower) until you deploy it.
          </p>
        )}
        {app && (
          <div className="text-[11px] text-white/40 font-mono break-all">
            {app}.internal:4000
            {machineCount != null && machineCount > 0
              ? ` · ${machineCount} machine${machineCount === 1 ? "" : "s"}`
              : ""}
          </div>
        )}
        {pool && (
          <div className="flex items-center gap-3 pt-1 border-t border-white/[0.06] text-[11px]">
            <span className="text-white/50 font-medium">Warm pool</span>
            <span className="text-emerald-300/90">{pool.free} ready</span>
            {pool.booting > 0 && (
              <span className="text-amber-300/80">{pool.booting} warming</span>
            )}
            {pool.claimsInFlight > 0 && (
              <span className="text-sky-300/80">
                {pool.claimsInFlight} claiming
              </span>
            )}
            <span className="text-white/35 ml-auto">target {pool.min}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
