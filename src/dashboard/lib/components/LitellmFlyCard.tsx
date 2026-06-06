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
import { SimpleTooltip } from "./SimpleTooltip";

export type LitellmFlyState =
  | "off"
  | "running"
  | "suspended"
  | "stopped"
  | "unknown";

export interface LitellmStatus {
  state: LitellmFlyState;
  free: number | null;
}

interface LitellmFlyCardProps {
  /** Authenticated request headers (x-kody-token / -owner / -repo). */
  headers: Record<string, string>;
  /** True only when FLY_API_TOKEN is configured in the repo vault. */
  flyTokenConfigured: boolean;
  /** Reports the current LiteLLM state + warm-pool free count to the parent. */
  onStatusChange?: (status: LitellmStatus) => void;
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
  onStatusChange,
}: LitellmFlyCardProps) {
  const [state, setState] = useState<LitellmFlyState>("unknown");
  const [pool, setPool] = useState<PoolStatus | null>(null);
  const [loading, setLoading] = useState(false);
  // Report the latest status to the parent so the section header can show
  // a live state + warm-pool free count without scrolling into the card.
  useEffect(() => {
    onStatusChange?.({ state, free: pool?.free ?? null });
  }, [state, pool, onStatusChange]);

  const refresh = useCallback(async () => {
    if (!flyTokenConfigured || Object.keys(headers).length === 0) {
      setState("off");
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

  // Read-only one-line strip: a dot + state word + "N ready", with refresh.
  // The shared proxy has no editable controls, so it's a status readout, not
  // a full card. The deeper free/warming/claiming breakdown lives on the
  // Machines tab. The page-level banner owns the FLY_API_TOKEN gate.
  const dotColor =
    state === "running"
      ? "bg-emerald-400"
      : state === "suspended"
        ? "bg-amber-400"
        : state === "stopped"
          ? "bg-rose-400"
          : "bg-white/30";

  return (
    <Card className="border-white/[0.08] bg-white/[0.03]">
      <CardContent className="p-3 flex items-center gap-2 text-xs">
        <Server className="w-4 h-4 text-sky-400 shrink-0" />
        <span className="font-semibold">Model proxy (LiteLLM)</span>
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor} ml-1`} />
        <span className="text-white/60">{pillLabel(state)}</span>
        {pool && (
          <span className="text-emerald-300/90">· {pool.free} ready</span>
        )}
        <SimpleTooltip
          content="Status display — you can't change it from here."
          side="bottom"
        >
          <span className="ml-2 text-[10px] text-white/30 uppercase tracking-wide cursor-help">
            read-only
          </span>
        </SimpleTooltip>
        <Button
          size="sm"
          variant="ghost"
          onClick={refresh}
          disabled={loading || !flyTokenConfigured}
          className="ml-auto h-6 px-1.5 text-white/40 hover:text-white/70"
          title="Refresh status"
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
