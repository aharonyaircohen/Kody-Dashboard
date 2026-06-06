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
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  Copy,
  Info,
  Loader2,
  Pause,
  Play,
  Power,
  RefreshCw,
} from "lucide-react";

import { Checkbox } from "@dashboard/ui/checkbox";

import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";
import { ConfirmDialog } from "./ConfirmDialog";
import { SimpleTooltip } from "./SimpleTooltip";
import { useAuth, type FlyPerfTier } from "../auth-context";

// Brain has its own size, independent of the task-run speed. Same intent
// names as Task runners; the spec is in the hint.
const BRAIN_SIZE_DEFAULT: FlyPerfTier = "medium";
const BRAIN_SIZE_ORDER: FlyPerfTier[] = ["low", "medium", "high"];
const BRAIN_SIZE_LABELS: Record<FlyPerfTier, { label: string; hint: string }> =
  {
    low: { label: "Economy", hint: "shared 2× / 2 GB — cheapest" },
    medium: { label: "Balanced", hint: "performance 1× / 2 GB — default" },
    high: { label: "Fast", hint: "performance 2× / 4 GB — costs more" },
  };

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
  /** Reports the current Brain lifecycle state to the parent. */
  onStatusChange?: (state: BrainFlyState) => void;
}

interface StatusResponse {
  state?: BrainFlyState;
  app?: string;
  url?: string;
  machineId?: string;
  error?: string;
  stored?: {
    version: 1;
    appName: string;
    orgSlug: string;
    createdAt: string;
  } | null;
}

interface ProvisionResponse {
  app?: string;
  url?: string;
  apiKey?: string;
  machineId?: string;
  /**
   * Set when ensureApp auto-renamed because the default slug was taken or
   * owned by an org the token can't see. UI surfaces a notice so the
   * user understands why the stored record shows a `-2`/`-3` suffix.
   */
  originalName?: string;
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
      return "Sleeping";
    case "stopped":
      return "Stopped";
    default:
      return "Unknown";
  }
}

export function BrainFlyCard({
  headers,
  flyTokenConfigured,
  onStatusChange,
}: BrainFlyCardProps) {
  const { auth, updateIntegrations } = useAuth();
  const brainPerf: FlyPerfTier = auth?.brainPerf ?? BRAIN_SIZE_DEFAULT;
  const [state, setState] = useState<BrainFlyState>("unknown");
  const [app, setApp] = useState<string | null>(null);
  const [stored, setStored] = useState<StatusResponse["stored"]>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<
    | "idle"
    | "provisioning"
    | "destroying"
    | "suspending"
    | "resuming"
    | "clearing-record"
  >("idle");
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Report the latest state to the parent so the section header can show
  // a live status dot + label without scrolling into the card.
  useEffect(() => {
    onStatusChange?.(state);
  }, [state, onStatusChange]);
  // Optional Fly app name override. The default slug
  // `kody-brain-<github-login>` is globally unique on Fly — if a previous
  // account held the name and never freed it, the only way forward is to
  // pick a different slug. Persisted in localStorage so the choice
  // follows the user across page reloads. Empty string = use default.
  const [customAppName, setCustomAppName] = useState("");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("kody.brain.appName");
      if (typeof saved === "string") setCustomAppName(saved);
    } catch {
      // localStorage unavailable — fall back to default slug.
    }
  }, []);
  useEffect(() => {
    try {
      if (customAppName)
        localStorage.setItem("kody.brain.appName", customAppName);
      else localStorage.removeItem("kody.brain.appName");
    } catch {
      // ignore — best-effort persistence
    }
  }, [customAppName]);
  // Per-repo `.kody/dashboard.json` flag — whether the "Kody Brain (Fly)"
  // row is offered in the chat picker. Default off. Independent of the
  // provision lifecycle above and of Fly task execution.
  const [chatEnabled, setChatEnabled] = useState(false);
  const [chatToggleBusy, setChatToggleBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!flyTokenConfigured || Object.keys(headers).length === 0) {
      setState("off");
      setApp(null);
      setStored(null);
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
      setStored(body.stored ?? null);
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
      const trimmedOverride = customAppName.trim();
      const res = await fetch("/api/kody/brain/provision", {
        method: "POST",
        headers: { ...headers, "x-kody-brain-perf": brainPerf },
        body: JSON.stringify(
          trimmedOverride.length > 0 ? { appName: trimmedOverride } : {},
        ),
      });
      const body = (await res.json().catch(() => ({}))) as ProvisionResponse;
      if (!res.ok) {
        toast.error(body.error ?? `Provision failed (HTTP ${res.status})`);
        return;
      }
      if (body.originalName) {
        // ensureApp auto-renamed because the default slug was taken (likely
        // a previous Fly org or another account owns it). The new app is
        // the actual brain — note the rename so the user understands why
        // the stored name carries a `-2`/`-3` suffix.
        toast.success(
          `Brain on Fly is on (used ${body.app} because ${body.originalName} was unreachable).`,
          { duration: 6000 },
        );
      } else {
        toast.success(
          "Brain on Fly is on — first chat may take ~30s to warm up",
        );
      }
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
      setStored(null);
    } catch (err) {
      toast.error(`Destroy failed: ${(err as Error).message}`);
    } finally {
      setBusy("idle");
      setConfirmOpen(false);
    }
  }

  /**
   * Clear the stored record at `.kody/users/<login>/data/brain.json`
   * without touching Fly. Use this for the orphan case: the dashboard
   * remembers a brain app the user can no longer reach (token revoked,
   * app moved orgs, etc.) and the user wants to start fresh.
   */
  async function clearStoredRecord() {
    setBusy("clearing-record");
    try {
      const res = await fetch("/api/kody/brain/stored", {
        method: "DELETE",
        headers,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error(body.error ?? `Clear failed (HTTP ${res.status})`);
        return;
      }
      toast.success("Stored Brain record cleared");
      setStored(null);
    } catch (err) {
      toast.error(`Clear failed: ${(err as Error).message}`);
    } finally {
      setBusy("idle");
    }
  }

  // "On" means the Fly app exists in any of the live states. Suspended
  // is still "on" — it just means no traffic for a while.
  const isOn =
    state === "running" || state === "suspended" || state === "stopped";

  // Orphan: the dashboard has a stored record for this user but the Fly
  // token can't see the app (token revoked, app moved to a different
  // org, slug taken by another account, etc.). The user can clear the
  // record to start fresh, or just hit Turn on and let the auto-rename
  // in `ensureApp` pick a new slug.
  const isOrphan = state === "off" && stored !== null;

  return (
    <>
      <Card className="border-white/[0.08] bg-white/[0.03]">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-violet-400" />
            <h2 className="text-sm font-semibold">Brain on Fly</h2>
            <SimpleTooltip
              content="Your personal Brain server on Fly. Sleeps when idle, wakes in ~1s on the next chat — no manual wake-up needed."
              side="right"
            >
              <Info className="w-3.5 h-3.5 text-white/50 hover:text-white/80 cursor-help" />
            </SimpleTooltip>
            <span
              className={`ml-2 px-2 py-0.5 rounded-full border text-[10px] font-medium uppercase tracking-wide ${pillClasses(
                state,
              )}`}
            >
              {pillLabel(state)}
            </span>
            <SimpleTooltip
              side="right"
              content={
                <div className="space-y-1 text-xs">
                  <div>
                    <span className="font-semibold">Off</span> — not deployed
                  </div>
                  <div>
                    <span className="font-semibold">Running</span> — live, ready
                    for chats
                  </div>
                  <div>
                    <span className="font-semibold">Sleeping</span> — paused;
                    auto-resumes in ~1s on next chat
                  </div>
                  <div>
                    <span className="font-semibold">Stopped</span> — shut down
                    (manual only)
                  </div>
                </div>
              }
            >
              <Info className="w-3 h-3 text-white/50 hover:text-white/80 cursor-help" />
            </SimpleTooltip>
            <SimpleTooltip
              content="Only affects this browser — not other users."
              side="bottom"
            >
              <span className="ml-2 text-[10px] text-white/35 uppercase tracking-wide cursor-help">
                just you
              </span>
            </SimpleTooltip>
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

          {/* Brain size — its OWN setting, not the task-run speed. */}
          {flyTokenConfigured && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/70">Size</span>
                <SimpleTooltip
                  content={`${BRAIN_SIZE_LABELS[brainPerf].hint}${isOn ? " Applies next time you turn Brain off then on." : ""}`}
                  side="right"
                >
                  <Info className="w-3 h-3 text-white/50 hover:text-white/80 cursor-help" />
                </SimpleTooltip>
              </div>
              <div className="flex gap-1.5">
                {BRAIN_SIZE_ORDER.map((tier) => {
                  const active = brainPerf === tier;
                  return (
                    <button
                      key={tier}
                      type="button"
                      onClick={() =>
                        updateIntegrations({
                          brainPerf: tier === BRAIN_SIZE_DEFAULT ? null : tier,
                        })
                      }
                      title={BRAIN_SIZE_LABELS[tier].hint}
                      className={`flex-1 rounded-md border px-2 py-1.5 text-xs transition ${
                        active
                          ? "border-violet-500/50 bg-violet-500/15 text-violet-200"
                          : "border-white/10 bg-black/20 text-white/60 hover:text-white/80"
                      }`}
                    >
                      {BRAIN_SIZE_LABELS[tier].label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {flyTokenConfigured && (
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <Checkbox
                checked={chatEnabled}
                disabled={chatToggleBusy}
                onCheckedChange={(v) => void toggleChatEnabled(v === true)}
                className="mt-0.5"
              />
              <span className="text-xs text-white/60 leading-relaxed flex items-center gap-1.5">
                Offer &ldquo;Kody Brain (Fly)&rdquo; in the chat picker.
                <SimpleTooltip
                  content="Off by default. Chat-only — Fly task execution is unaffected."
                  side="right"
                >
                  <Info className="w-3 h-3 text-white/50 hover:text-white/80 cursor-help" />
                </SimpleTooltip>
              </span>
            </label>
          )}
          {flyTokenConfigured && !isOn && (
            <div className="space-y-1">
              <label
                htmlFor="brain-app-name"
                className="text-[11px] text-white/55 flex items-center gap-1.5"
              >
                Fly app name{" "}
                <span className="text-white/35">(leave empty for default)</span>
                <SimpleTooltip
                  content="Use a custom name if Fly is holding your default slug from a previous account. Lowercase letters, numbers, and hyphens only."
                  side="right"
                >
                  <Info className="w-3 h-3 text-white/50 hover:text-white/80 cursor-help" />
                </SimpleTooltip>
              </label>
              <input
                id="brain-app-name"
                type="text"
                value={customAppName}
                onChange={(e) => setCustomAppName(e.target.value)}
                placeholder={`kody-brain-${auth?.user.login ?? "<login>"}`}
                spellCheck={false}
                autoComplete="off"
                className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs font-mono text-white/85 placeholder:text-white/30 focus:border-violet-500/50 focus:outline-none"
              />
            </div>
          )}
          {app && (
            <div className="flex items-center gap-1.5 text-[11px] text-white/40 font-mono break-all">
              <span>https://{app}.fly.dev</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-5 px-1.5 shrink-0"
                title="Copy Brain URL"
                onClick={() => {
                  navigator.clipboard.writeText(`https://${app}.fly.dev`);
                  toast.success("Brain URL copied");
                }}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          )}
          {isOrphan && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/15 p-2.5 text-[12px] text-amber-50 space-y-2">
              <div>
                Can&apos;t reach the stored Brain app{" "}
                <span className="font-mono">{stored?.appName}</span>. Turn on
                will create a fresh one.
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={clearStoredRecord}
                disabled={busy !== "idle" || !flyTokenConfigured}
                className="text-amber-50 hover:text-white h-7 px-2"
              >
                {busy === "clearing-record" ? "Clearing…" : "Forget this Brain"}
              </Button>
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
