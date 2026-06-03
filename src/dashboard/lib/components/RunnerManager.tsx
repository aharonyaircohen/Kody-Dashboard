/**
 * @fileType component
 * @domain runner
 * @pattern runner-manager
 * @ai-summary Single home for ALL Fly.io runner configuration, split into two
 *   clearly labeled groups by blast radius:
 *     • Repo-wide (shared by everyone on the repo): FLY_API_TOKEN status, the
 *       warm-pool size (POOL_MIN vault secret, read by the always-on pool
 *       owner), LiteLLM proxy status, Brain-on-Fly.
 *     • Your sessions (this browser only): the per-user perf tier (VM size),
 *       stored in localStorage.kody_auth.flyPerf via useAuth.
 *   The Fly token itself is set on /secrets. Nothing Fly-related lives on
 *   /settings anymore — see [[feedback_settings_per_user_only]].
 */
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  KeyRound,
  Rocket,
  Server,
  User,
  Users,
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
          </TabsList>

          {/* ═══ Machines: what's running, act on it ════════════════════ */}
          <TabsContent value="machines" className="mt-4">
            <FlyMachinesTable
              headers={vaultHeaders()}
              flyTokenConfigured={flyTokenConfigured}
            />
          </TabsContent>

          {/* ═══ Configuration: per-feature settings ════════════════════ */}
          <TabsContent value="config" className="mt-4 space-y-6">
            <section className="space-y-3">
              <GroupHeader
                icon={Users}
                label="Repo-wide"
                hint="affects everyone on this repo"
              />

              {/* Fly Machines token (read-only status) */}
              <Card className="border-white/[0.08] bg-white/[0.03]">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-sky-400" />
                    <h2 className="text-sm font-semibold">
                      Fly Machines token
                    </h2>
                  </div>
                  <p className="text-xs text-white/50">
                    Runs chat/issue agents on Fly.io instead of GitHub Actions.
                    Set <span className="font-mono">FLY_API_TOKEN</span> on the{" "}
                    <Link
                      href="/secrets"
                      className="text-sky-400 hover:underline"
                    >
                      Secrets
                    </Link>{" "}
                    page — currently{" "}
                    {flyTokenConfigured ? (
                      <span className="text-emerald-300">configured</span>
                    ) : (
                      <span className="text-amber-300">not set</span>
                    )}
                    . Without it, every Fly feature falls back to GitHub
                    Actions.
                  </p>
                </CardContent>
              </Card>

              {/* Warm pool size */}
              <Card className="border-white/[0.08] bg-white/[0.03]">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-sky-400" />
                    <h2 className="text-sm font-semibold">Warm pool size</h2>
                  </div>
                  <p className="text-xs text-white/50">
                    Machines kept pre-booted and frozen so a chat/issue run
                    claims one instantly instead of cold-starting.{" "}
                    {POOL_MIN_DEFAULT} by default, up to {POOL_MIN_MAX}. Each
                    warm machine is a paid Fly VM; set 0 to always cold-start.{" "}
                    {flyTokenConfigured
                      ? "Resizing takes effect within ~1 minute."
                      : "Takes effect once FLY_API_TOKEN is set."}
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

              {/* LiteLLM proxy status (read-only) */}
              <LitellmFlyCard
                headers={vaultHeaders()}
                flyTokenConfigured={flyTokenConfigured}
              />

              {/* Brain on Fly toggle */}
              <BrainFlyCard
                headers={vaultHeaders()}
                flyTokenConfigured={flyTokenConfigured}
              />

              {/* Per-PR preview machine size + lifecycle (idle-suspend, TTL) */}
              <PreviewsCard
                headers={vaultHeaders()}
                flyTokenConfigured={flyTokenConfigured}
              />

              {/* Manual branch previews (PR-less, e.g. dev) */}
              <BranchPreviewCard
                headers={vaultHeaders()}
                flyTokenConfigured={flyTokenConfigured}
              />
            </section>

            {/* ═══ Your sessions ════════════════════════════════════════════ */}
            <section className="space-y-3">
              <GroupHeader
                icon={User}
                label="Your sessions"
                hint="this browser only, doesn't affect others"
              />
              <Card className="border-white/[0.08] bg-white/[0.03]">
                <CardContent className="p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <Rocket className="w-4 h-4 text-sky-400" />
                    <h2 className="text-sm font-semibold">Performance tier</h2>
                  </div>
                  <p className="text-xs text-white/50 -mt-2">
                    VM size for the Fly runs you start from this browser.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="fly-perf" className="text-xs text-white/70">
                      VM size
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
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}
