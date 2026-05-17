/**
 * @fileType component
 * @domain settings
 * @pattern brain-fly-card
 *
 * Settings → Brain on Fly card. Single source of truth for whether the
 * per-user Brain Fly app exists. Replaces the in-chat status bar:
 *
 *   - "Brain on Fly" header + status pill (Off / Running / Suspended).
 *   - Turn on  → POST /api/kody/brain/provision (idempotent).
 *   - Suspend  → POST /api/kody/brain/suspend (when running).
 *   - Resume   → POST /api/kody/brain/resume  (when suspended/stopped).
 *   - Turn off → POST /api/kody/brain/destroy (with confirm).
 *   - Refresh  → re-fetch GET /api/kody/brain/status.
 *
 * Suspend/resume are also automatic: the machine auto-suspends after idle
 * and auto-resumes in ~1s on the next chat. The explicit buttons let the
 * user force a pause now (zero compute) without tearing down the app.
 *
 * Visibility: rendered only when the connected repo has FLY_API_TOKEN in
 * its vault (same gate as the existing Fly Runner card). Without that
 * token the toggle would just fail at provision time.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Brain, Loader2, Pause, Play, Power, RefreshCw } from "lucide-react";

import { Checkbox } from "@dashboard/ui/checkbox";

import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";
import { ConfirmDialog } from "./ConfirmDialog";

export type BrainFlyState =
  | "off"
  | "running"
  | "suspended"
  | "stopped"
  | "unknown";

interface BrainFlyCardProps {
  /** Authenticated request headers (x-kody-token / -owner / -repo). */
  headers: Record<string, string>;
  /** True only when FLY_API_TOKEN is configured in the repo vault. */
  flyTokenConfigured: boolean;
}

interface StatusResponse {
  state?: BrainFlyState;
  app?: string;
  url?: string;
  machineId?: string;
  error?: string;
}

interface ProvisionResponse {
  app?: string;
  url?: string;
  apiKey?: string;
  machineId?: string;
  error?: string;
}

function pillClasses(state: BrainFlyState): string {
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

function pillLabel(state: BrainFlyState): string {
  switch (state) {
    case "off":
      return "Off";
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

export function BrainFlyCard({
  headers,
  flyTokenConfigured,
}: BrainFlyCardProps) {
  const [state, setState] = useState<BrainFlyState>("unknown");
  const [app, setApp] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<
    "idle" | "provisioning" | "destroying" | "suspending" | "resuming"
  >("idle");
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Per-repo `.kody/dashboard.json` flag — whether the "Kody Brain (Fly)"
  // row is offered in the chat picker. Default off. Independent of the
  // provision lifecycle above and of Fly task execution.
  const [chatEnabled, setChatEnabled] = useState(false);
  const [chatToggleBusy, setChatToggleBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!flyTokenConfigured || Object.keys(headers).length === 0) {
      setState("off");
      setApp(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/kody/brain/status", { headers });
      if (!res.ok) {
        setState("unknown");
        return;
      }
      const body = (await res.json()) as StatusResponse;
      setState(body.state ?? "unknown");
      setApp(body.app ?? null);
    } catch {
      setState("unknown");
    } finally {
      setLoading(false);
    }
  }, [headers, flyTokenConfigured]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Load the per-repo chat-picker flag. Silent on failure — defaults to
  // off, matching a missing/empty config.
  useEffect(() => {
    let cancelled = false;
    if (Object.keys(headers).length === 0) return;
    fetch("/api/kody/dashboard-config", { headers })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((json: { config?: { brainFlyChatEnabled?: boolean } }) => {
        if (!cancelled) {
          setChatEnabled(json.config?.brainFlyChatEnabled === true);
        }
      })
      .catch(() => {
        if (!cancelled) setChatEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [headers]);

  async function toggleChatEnabled(next: boolean) {
    setChatToggleBusy(true);
    // Optimistic: reflect immediately, revert on failure.
    setChatEnabled(next);
    try {
      const res = await fetch("/api/kody/dashboard-config", {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ brainFlyChatEnabled: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? `Save failed (HTTP ${res.status})`);
        setChatEnabled(!next);
        return;
      }
      toast.success(
        next
          ? "Kody Brain (Fly) is now offered in chat"
          : "Kody Brain (Fly) hidden from chat",
      );
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
      setChatEnabled(!next);
    } finally {
      setChatToggleBusy(false);
    }
  }

  async function turnOn() {
    setBusy("provisioning");
    try {
      const res = await fetch("/api/kody/brain/provision", {
        method: "POST",
        headers,
      });
      const body = (await res.json().catch(() => ({}))) as ProvisionResponse;
      if (!res.ok) {
        toast.error(body.error ?? `Provision failed (HTTP ${res.status})`);
        return;
      }
      toast.success("Brain on Fly is on — first chat may take ~30s to warm up");
      // Refresh shows running/starting; subsequent polls will pick up
      // suspended state if the user doesn't chat for a while.
      await refresh();
    } catch (err) {
      toast.error(`Provision failed: ${(err as Error).message}`);
    } finally {
      setBusy("idle");
    }
  }

  async function suspend() {
    setBusy("suspending");
    try {
      const res = await fetch("/api/kody/brain/suspend", {
        method: "POST",
        headers,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? `Suspend failed (HTTP ${res.status})`);
        return;
      }
      toast.success("Brain suspended — resumes on next chat or Resume click");
      await refresh();
    } catch (err) {
      toast.error(`Suspend failed: ${(err as Error).message}`);
    } finally {
      setBusy("idle");
    }
  }

  async function resume() {
    setBusy("resuming");
    try {
      const res = await fetch("/api/kody/brain/resume", {
        method: "POST",
        headers,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? `Resume failed (HTTP ${res.status})`);
        return;
      }
      toast.success("Brain resumed");
      await refresh();
    } catch (err) {
      toast.error(`Resume failed: ${(err as Error).message}`);
    } finally {
      setBusy("idle");
    }
  }

  async function turnOff() {
    setBusy("destroying");
    try {
      const res = await fetch("/api/kody/brain/destroy", {
        method: "POST",
        headers,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? `Destroy failed (HTTP ${res.status})`);
        return;
      }
      toast.success("Brain on Fly is off");
      setState("off");
      setApp(null);
    } catch (err) {
      toast.error(`Destroy failed: ${(err as Error).message}`);
    } finally {
      setBusy("idle");
      setConfirmOpen(false);
    }
  }

  // "On" means the Fly app exists in any of the live states. Suspended
  // is still "on" — it just means no traffic for a while.
  const isOn =
    state === "running" || state === "suspended" || state === "stopped";

  return (
    <>
      <Card className="border-white/[0.08] bg-white/[0.03]">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-violet-400" />
            <h2 className="text-sm font-semibold">Brain on Fly</h2>
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
            Per-user Brain server on your Fly account. Suspends when idle
            (resumes in ~1s on the next chat) — no manual wake-up required.
          </p>
          {!flyTokenConfigured && (
            <p className="text-[11px] text-amber-300/80 italic">
              Add FLY_API_TOKEN to the repo Secrets vault to enable.
            </p>
          )}
          {flyTokenConfigured && (
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <Checkbox
                checked={chatEnabled}
                disabled={chatToggleBusy}
                onCheckedChange={(v) => void toggleChatEnabled(v === true)}
                className="mt-0.5"
              />
              <span className="text-xs text-white/60 leading-relaxed">
                Offer &ldquo;Kody Brain (Fly)&rdquo; in the chat picker.
                <span className="block text-[11px] text-white/35">
                  Off by default. Chat-only — Fly task execution is
                  unaffected.
                </span>
              </span>
            </label>
          )}
          {app && (
            <div className="text-[11px] text-white/40 font-mono break-all">
              {app}.fly.dev
            </div>
          )}
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            {isOn ? (
              <>
                {state === "running" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={suspend}
                    disabled={busy !== "idle" || !flyTokenConfigured}
                    className="text-amber-300 hover:text-amber-200"
                    title="Pause the machine now (auto-resumes on next chat)"
                  >
                    <Pause className="w-3 h-3 mr-1" />
                    {busy === "suspending" ? "Suspending…" : "Suspend"}
                  </Button>
                )}
                {(state === "suspended" || state === "stopped") && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={resume}
                    disabled={busy !== "idle" || !flyTokenConfigured}
                    className="text-emerald-300 hover:text-emerald-200"
                    title="Wake the machine without sending a chat"
                  >
                    <Play className="w-3 h-3 mr-1" />
                    {busy === "resuming" ? "Resuming…" : "Resume"}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmOpen(true)}
                  disabled={busy !== "idle" || !flyTokenConfigured}
                  className="text-rose-300 hover:text-rose-200 ml-auto"
                >
                  <Power className="w-3 h-3 mr-1" />
                  {busy === "destroying" ? "Turning off…" : "Turn off"}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                onClick={turnOn}
                disabled={busy !== "idle" || !flyTokenConfigured}
              >
                <Power className="w-3 h-3 mr-1" />
                {busy === "provisioning" ? "Turning on…" : "Turn on"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmOpen}
        title="Turn off Brain on Fly?"
        description="Tears down the Fly app and any sessions stored on its filesystem. The agent disappears from the chat picker until you turn it back on. Re-enabling takes ~30s."
        confirmLabel={busy === "destroying" ? "Turning off…" : "Turn off"}
        variant="destructive"
        onConfirm={turnOff}
        onClose={() => setConfirmOpen(false)}
      />
    </>
  );
}
