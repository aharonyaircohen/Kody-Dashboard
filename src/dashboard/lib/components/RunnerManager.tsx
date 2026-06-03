/**
 * @fileType component
 * @domain runner
 * @pattern runner-manager
 * @ai-summary The Fly page (/runner), three tabs: Configuration (default),
 *   Machines (live inventory + actions), Activity. The Configuration tab is
 *   grouped BY FEATURE so each setting's owner + effect is obvious:
 *     • Previews — per-PR preview size, idle-suspend, expiry (PreviewsCard) +
 *       manual branch previews.
 *     • Runners — warm-pool size (POOL_MIN vault, repo-wide) + VM size (the
 *       per-user perf tier, this browser only, localStorage.kody_auth.flyPerf).
 *     • Brain — per-user Brain-on-Fly. • LiteLLM — shared proxy status.
 *   Fly token status sits on top (gates everything); the token is set on
 *   /secrets. Health-check is deliberately not exposed (footgun — defeats
 *   auto-suspend); it defaults off in code.
 */
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Brain,
  Cpu,
  Globe,
  KeyRound,
  Rocket,
  Server,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dashboard/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@dashboard/ui/tabs";
import { BrainFlyCard } from "./BrainFlyCard";
import { BranchPreviewCard } from "./BranchPreviewCard";
import { FlyActivityTab } from "./FlyActivityTab";
import { FlyMachinesTable } from "./FlyMachinesTable";
import { LitellmFlyCard } from "./LitellmFlyCard";
import { PreviewsCard } from "./PreviewsCard";
import { PageShell } from "./PageShell";
import { VaultLockedBanner } from "./VaultLockedBanner";
import { useAuth, type FlyPerfTier } from "../auth-context";
import { getStoredAuth } from "../api";

/** Vault key under which the project-scoped Fly Machines token is stored. */
const FLY_VAULT_KEY = "FLY_API_TOKEN";
/** Vault key sizing the per-repo warm pool. Kept byte-identical to the engine
 * (kody2 src/pool/registry.ts POOL_MIN_VAULT_KEY) which reads it. */
const POOL_MIN_VAULT_KEY = "POOL_MIN";
/** Default + ceiling — mirror the engine's clamp so the UI rejects what the
 * pool would clamp anyway. */
const POOL_MIN_DEFAULT = 2;
const POOL_MIN_MAX = 10;

const FLY_PERF_DEFAULT: FlyPerfTier = "medium";

const FLY_PERF_LABELS: Record<FlyPerfTier, { label: string; hint: string }> = {
  low: {
    label: "Low — shared CPU, 2GB",
    hint: "Cheapest. Fine for chat-only sessions; pnpm install / tsc are slower.",
  },
  medium: {
    label: "Medium — performance-1x, 2GB (default)",
    hint: "Balanced. Good for vibe coding; most build/test loops feel snappy.",
  },
  high: {
    label: "High — performance-2x, 4GB",
    hint: "Fastest. For heavy installs, parallel tests, or large repos. Costlier.",
  },
};

function vaultHeaders(): Record<string, string> {
  const auth = getStoredAuth();
  return auth
    ? {
        "x-kody-token": auth.token,
        "x-kody-owner": auth.owner,
        "x-kody-repo": auth.repo,
      }
    : {};
}

/** Group divider — labels each block by who it affects. */
function GroupHeader({
  icon: Icon,
  label,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-center gap-2 px-1">
      <Icon className="w-3.5 h-3.5 text-white/40" />
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
        {label}
      </h2>
      <span className="text-[11px] text-white/30">— {hint}</span>
    </div>
  );
}

export function RunnerManager() {
  const { auth, updateIntegrations } = useAuth();

  // ─── Repo-wide: FLY_API_TOKEN probe + warm pool size ────────────────────
  const [flyTokenConfigured, setFlyTokenConfigured] = useState(false);
  const [poolMin, setPoolMin] = useState("");
  const [poolMinSaved, setPoolMinSaved] = useState("");
  const [poolMinSaving, setPoolMinSaving] = useState(false);

  // ─── Per-user: perf tier (VM size for THIS browser's runs) ──────────────
  const [flyPerf, setFlyPerf] = useState<FlyPerfTier>(FLY_PERF_DEFAULT);

  const probeFlyToken = useCallback(async () => {
    const headers = vaultHeaders();
    if (Object.keys(headers).length === 0) {
      setFlyTokenConfigured(false);
      return;
    }
    try {
      const res = await fetch(`/api/kody/secrets/${FLY_VAULT_KEY}/value`, {
        headers,
      });
      if (!res.ok) {
        setFlyTokenConfigured(false);
        return;
      }
      const body = (await res.json()) as { value?: string };
      setFlyTokenConfigured(Boolean(body.value));
    } catch {
      setFlyTokenConfigured(false);
    }
  }, []);

  const loadPoolMin = useCallback(async () => {
    const headers = vaultHeaders();
    if (Object.keys(headers).length === 0) {
      setPoolMin("");
      setPoolMinSaved("");
      return;
    }
    try {
      const res = await fetch(`/api/kody/secrets/${POOL_MIN_VAULT_KEY}/value`, {
        headers,
      });
      if (!res.ok) {
        setPoolMin("");
        setPoolMinSaved("");
        return;
      }
      const body = (await res.json()) as { value?: string };
      const v = body.value ?? "";
      setPoolMin(v);
      setPoolMinSaved(v);
    } catch {
      setPoolMin("");
      setPoolMinSaved("");
    }
  }, []);

  useEffect(() => {
    void probeFlyToken();
    void loadPoolMin();
  }, [probeFlyToken, loadPoolMin]);

  // Seed the per-user perf tier from auth (or on repo switch).
  useEffect(() => {
    setFlyPerf(auth?.flyPerf ?? FLY_PERF_DEFAULT);
  }, [auth?.flyPerf]);

  const poolMinHasChanges = poolMin.trim() !== poolMinSaved.trim();
  const flyHasChanges = flyPerf !== (auth?.flyPerf ?? FLY_PERF_DEFAULT);

  function saveFly() {
    updateIntegrations({
      flyPerf: flyPerf === FLY_PERF_DEFAULT ? null : flyPerf,
    });
    toast.success("Fly performance tier saved");
  }

  async function savePoolMin() {
    const n = Number(poolMin.trim());
    if (!Number.isInteger(n) || n < 0 || n > POOL_MIN_MAX) {
      toast.error(
        `Warm pool size must be a whole number from 0 to ${POOL_MIN_MAX}`,
      );
      return;
    }
    setPoolMinSaving(true);
    try {
      const res = await fetch(`/api/kody/secrets`, {
        method: "POST",
        headers: { "content-type": "application/json", ...vaultHeaders() },
        body: JSON.stringify({ name: POOL_MIN_VAULT_KEY, value: String(n) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(body.message ?? `Save failed (${res.status})`);
      }
      setPoolMin(String(n));
      setPoolMinSaved(String(n));
      toast.success("Warm pool size saved");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save warm pool size",
      );
    } finally {
      setPoolMinSaving(false);
    }
  }

  return (
    <PageShell
      title="Fly Runner"
      icon={Rocket}
      iconClassName="text-sky-400"
      subtitle="Fly.io runner configuration"
    >
      <div className="space-y-4">
        {/* If the vault can't be read, the FLY_API_TOKEN probe below reports
            "not configured" for the wrong reason — surface the real failure. */}
        <VaultLockedBanner feature="Fly runners and previews stay off until the vault can be read." />

        {/* Two tabs keep the (potentially long) live-machine list from burying
            the settings: Machines = what's running + inline actions;
            Configuration = the per-feature knobs. */}
        <Tabs defaultValue="config">
          <TabsList>
            <TabsTrigger value="config">Configuration</TabsTrigger>
            <TabsTrigger value="machines">Machines</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          {/* ═══ Machines: what's running, act on it ════════════════════ */}
          <TabsContent value="machines" className="mt-4">
            <FlyMachinesTable
              headers={vaultHeaders()}
              flyTokenConfigured={flyTokenConfigured}
            />
          </TabsContent>

          {/* ═══ Activity: working time / uptime / est. cost over time ═══ */}
          <TabsContent value="activity" className="mt-4">
            <FlyActivityTab
              headers={vaultHeaders()}
              flyTokenConfigured={flyTokenConfigured}
            />
          </TabsContent>

          {/* ═══ Configuration: grouped by feature ══════════════════════ */}
          <TabsContent value="config" className="mt-4 space-y-6">
            {/* Fly token — gates every feature below. */}
            <Card className="border-white/[0.08] bg-white/[0.03]">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-sky-400" />
                  <h2 className="text-sm font-semibold">Fly token</h2>
                  <span
                    className={`ml-1 text-[11px] ${flyTokenConfigured ? "text-emerald-300" : "text-amber-300"}`}
                  >
                    {flyTokenConfigured ? "configured" : "not set"}
                  </span>
                </div>
                <p className="text-xs text-white/50">
                  Required for everything below. Set{" "}
                  <span className="font-mono">FLY_API_TOKEN</span> on the{" "}
                  <Link
                    href="/secrets"
                    className="text-sky-400 hover:underline"
                  >
                    Secrets
                  </Link>{" "}
                  page. Without it, every Fly feature falls back to GitHub
                  Actions.
                </p>
              </CardContent>
            </Card>

            {/* ── Previews ─────────────────────────────────────────────── */}
            <section className="space-y-3">
              <GroupHeader
                icon={Globe}
                label="Previews"
                hint="temporary sites built for each PR"
              />
              <PreviewsCard
                headers={vaultHeaders()}
                flyTokenConfigured={flyTokenConfigured}
              />
              <BranchPreviewCard
                headers={vaultHeaders()}
                flyTokenConfigured={flyTokenConfigured}
              />
            </section>

            {/* ── Runners ──────────────────────────────────────────────── */}
            <section className="space-y-3">
              <GroupHeader
                icon={Server}
                label="Runners"
                hint="machines that run chat & Vibe tasks"
              />

              {/* Warm pool size (repo-wide) */}
              <Card className="border-white/[0.08] bg-white/[0.03]">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-sky-400" />
                    <h2 className="text-sm font-semibold">Warm pool size</h2>
                    <span className="ml-auto text-[10px] text-white/35 uppercase tracking-wide">
                      affects everyone
                    </span>
                  </div>
                  <p className="text-xs text-white/50">
                    Machines kept pre-booted so a chat/issue run starts
                    instantly instead of cold-starting. {POOL_MIN_DEFAULT} by
                    default, up to {POOL_MIN_MAX}. Each warm machine is a paid
                    Fly VM; set 0 to always cold-start.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="pool-min" className="text-xs text-white/70">
                      Machines kept warm
                    </Label>
                    <Input
                      id="pool-min"
                      type="number"
                      min={0}
                      max={POOL_MIN_MAX}
                      step={1}
                      placeholder={`${POOL_MIN_DEFAULT} (default)`}
                      value={poolMin}
                      onChange={(e) => setPoolMin(e.target.value)}
                      className="bg-black/30 border-white/10 w-32"
                    />
                  </div>
                  <div className="pt-1">
                    <Button
                      size="sm"
                      onClick={savePoolMin}
                      disabled={!poolMinHasChanges || poolMinSaving}
                    >
                      {poolMinSaving ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* VM size (per-user) — was "Performance tier" */}
              <Card className="border-white/[0.08] bg-white/[0.03]">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Rocket className="w-4 h-4 text-sky-400" />
                    <h2 className="text-sm font-semibold">VM size</h2>
                    <span className="ml-auto text-[10px] text-white/35 uppercase tracking-wide">
                      your browser only
                    </span>
                  </div>
                  <p className="text-xs text-white/50">
                    How big the machine is for the chat &amp; Vibe runs you
                    start. Bigger = faster installs/tests, but costs more.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="fly-perf" className="text-xs text-white/70">
                      Size
                    </Label>
                    <Select
                      value={flyPerf}
                      onValueChange={(v) => setFlyPerf(v as FlyPerfTier)}
                    >
                      <SelectTrigger
                        id="fly-perf"
                        className="bg-black/30 border-white/10"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">
                          {FLY_PERF_LABELS.low.label}
                        </SelectItem>
                        <SelectItem value="medium">
                          {FLY_PERF_LABELS.medium.label}
                        </SelectItem>
                        <SelectItem value="high">
                          {FLY_PERF_LABELS.high.label}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-white/45 leading-snug">
                      {FLY_PERF_LABELS[flyPerf].hint}
                    </p>
                  </div>
                  <div className="pt-1">
                    <Button
                      size="sm"
                      onClick={saveFly}
                      disabled={!flyHasChanges}
                    >
                      Save
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </section>

            {/* ── Brain ────────────────────────────────────────────────── */}
            <section className="space-y-3">
              <GroupHeader
                icon={Brain}
                label="Brain"
                hint="your personal Brain server"
              />
              <BrainFlyCard
                headers={vaultHeaders()}
                flyTokenConfigured={flyTokenConfigured}
              />
            </section>

            {/* ── LiteLLM ──────────────────────────────────────────────── */}
            <section className="space-y-3">
              <GroupHeader
                icon={Cpu}
                label="LiteLLM"
                hint="shared model proxy"
              />
              <LitellmFlyCard
                headers={vaultHeaders()}
                flyTokenConfigured={flyTokenConfigured}
              />
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}
