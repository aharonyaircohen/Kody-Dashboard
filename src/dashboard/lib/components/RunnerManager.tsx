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
  Info,
  KeyRound,
  Rocket,
  Server,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";
import { Input } from "@dashboard/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@dashboard/ui/tabs";
import { BrainFlyCard, type BrainFlyState } from "./BrainFlyCard";
import { FlyActivityTab } from "./FlyActivityTab";
import { FlyMachinesTable } from "./FlyMachinesTable";
import {
  LitellmFlyCard,
  type LitellmStatus,
} from "./LitellmFlyCard";
import { PreviewsCard } from "./PreviewsCard";
import { PageShell } from "./PageShell";
import { SimpleTooltip } from "./SimpleTooltip";
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

// Plain-intent names for the per-user perf tier; the real Fly spec lives in
// the hint. Order low→medium→high == Economy→Balanced→Fast.
const FLY_PERF_LABELS: Record<FlyPerfTier, { label: string; hint: string }> = {
  low: {
    label: "Economy",
    hint: "Cheapest (shared 2× / 2 GB). Fine for chat; installs/tests are slower.",
  },
  medium: {
    label: "Balanced",
    hint: "Default (performance 1× / 2 GB). Good for most Vibe / build-test work.",
  },
  high: {
    label: "Fast",
    hint: "Fastest (performance 2× / 4 GB). For heavy installs or big repos. Costs more.",
  },
};

const PERF_ORDER: FlyPerfTier[] = ["low", "medium", "high"];

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

/** Tooltip copy for the blast-radius chips. Kept in one place so the wording
 * stays consistent between the per-section chips and any future chips. */
const SCOPE_CHIP_HINTS = {
  wholeRepo: "Applies to everyone using the repo.",
  justYou: "Only affects this browser — not other users.",
  readOnly: "Status display — you can't change it from here.",
};

const STATUS_DOT_COLORS: Record<string, string> = {
  running: "bg-emerald-400",
  suspended: "bg-amber-400",
  stopped: "bg-rose-400",
  off: "bg-white/30",
  unknown: "bg-white/20",
};

const STATUS_LABELS: Record<string, string> = {
  running: "Running",
  suspended: "Sleeping",
  stopped: "Stopped",
  off: "Off",
  unknown: "—",
};

function StatusDot({ state }: { state: string }) {
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full inline-block ${STATUS_DOT_COLORS[state] ?? STATUS_DOT_COLORS.unknown}`}
    />
  );
}

/** Group divider — labels each block by who it affects. The optional
 * `status` slot is for an at-a-glance live status pulled up from the
 * child card (e.g. "● Running · 3 ready" on the LiteLLM divider). */
function GroupHeader({
  icon: Icon,
  label,
  hint,
  status,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  status?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-1">
      <Icon className="w-3.5 h-3.5 text-white/40" />
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
        {label}
      </h2>
      <SimpleTooltip content={hint} side="right">
        <Info className="w-3 h-3 text-white/50 hover:text-white/80 cursor-help" />
      </SimpleTooltip>
      {status && (
        <span className="flex items-center gap-1.5 text-[10px] text-white/55 normal-case tracking-normal">
          {status}
        </span>
      )}
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

  // ─── At-a-glance section status (lifted from the child cards so the
  //     GroupHeader can show "● Running" / "● 3 ready" without scrolling). ─
  const [brainState, setBrainState] = useState<BrainFlyState>("unknown");
  const [litellmStatus, setLitellmStatus] = useState<LitellmStatus>({
    state: "unknown",
    free: null,
  });

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
            <TabsTrigger value="config">configuration</TabsTrigger>
            <SimpleTooltip
              content="Set FLY_API_TOKEN on the Secrets page to view live machines and activity."
              side="bottom"
              delayDuration={200}
            >
              <TabsTrigger value="machines" disabled={!flyTokenConfigured}>
                live machines
              </TabsTrigger>
            </SimpleTooltip>
            <SimpleTooltip
              content="Set FLY_API_TOKEN on the Secrets page to view live machines and activity."
              side="bottom"
              delayDuration={200}
            >
              <TabsTrigger value="activity" disabled={!flyTokenConfigured}>
                history
              </TabsTrigger>
            </SimpleTooltip>
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
                  <SimpleTooltip
                    side="right"
                    content={
                      <>
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
                      </>
                    }
                  >
                    <Info className="w-3.5 h-3.5 text-white/50 hover:text-white/80 cursor-help" />
                  </SimpleTooltip>
                  <span
                    className={`ml-auto text-[11px] ${flyTokenConfigured ? "text-emerald-300" : "text-amber-300"}`}
                  >
                    {flyTokenConfigured ? "configured" : "not set"}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* The four feature sections are gated by FLY_API_TOKEN. Until
                the token is set, the Fly token card above IS the page. */}
            {flyTokenConfigured && (
              <>

            {/* ── Previews ─────────────────────────────────────────────── */}
            <section className="space-y-3">
              <GroupHeader
                icon={Globe}
                label="Previews"
                hint="temporary sites built for each PR"
              />
              {/* Branch previews are folded into PreviewsCard ▸ Advanced. */}
              <PreviewsCard
                headers={vaultHeaders()}
                flyTokenConfigured={flyTokenConfigured}
              />
            </section>

            {/* ── Task runners ─────────────────────────────────────────── */}
            <section className="space-y-3">
              <GroupHeader
                icon={Server}
                label="Task runners"
                hint="machines that run chat & Vibe tasks"
                status={
                  litellmStatus.free != null ? (
                    <span className="flex items-center gap-1.5">
                      <StatusDot state={litellmStatus.state} />
                      {litellmStatus.free} ready
                    </span>
                  ) : null
                }
              />
              <Card className="border-white/[0.08] bg-white/[0.03]">
                <CardContent className="p-4 space-y-4">
                  {/* Speed of my runs — per-user (this browser) */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Rocket className="w-4 h-4 text-sky-400" />
                      <h2 className="text-sm font-semibold">
                        Speed of my runs
                      </h2>
                      <SimpleTooltip
                        content="Pick the VM size for YOUR chat & Vibe runs. Hover each tier for the spec."
                        side="right"
                      >
                        <Info className="w-3.5 h-3.5 text-white/50 hover:text-white/80 cursor-help" />
                      </SimpleTooltip>
                      <SimpleTooltip
                        content={SCOPE_CHIP_HINTS.justYou}
                        side="bottom"
                      >
                        <span className="ml-auto text-[10px] text-white/35 uppercase tracking-wide cursor-help">
                          just you
                        </span>
                      </SimpleTooltip>
                    </div>
                    <div className="flex gap-1.5">
                      {PERF_ORDER.map((tier) => {
                        const active = flyPerf === tier;
                        return (
                          <button
                            key={tier}
                            type="button"
                            onClick={() => setFlyPerf(tier)}
                            title={FLY_PERF_LABELS[tier].hint}
                            className={`flex-1 rounded-md border px-2 py-1.5 text-xs transition ${
                              active
                                ? "border-sky-500/50 bg-sky-500/15 text-sky-200"
                                : "border-white/10 bg-black/20 text-white/60 hover:text-white/80"
                            }`}
                          >
                            {FLY_PERF_LABELS[tier].label}
                          </button>
                        );
                      })}
                    </div>
                    <Button
                      size="sm"
                      onClick={saveFly}
                      disabled={!flyHasChanges}
                    >
                      Save my speed
                    </Button>
                  </div>

                  <div className="border-t border-white/[0.06]" />

                  {/* Keep machines ready — repo-wide (warm pool) */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Server className="w-4 h-4 text-sky-400" />
                      <h2 className="text-sm font-semibold">
                        Keep machines ready
                      </h2>
                      <SimpleTooltip
                        content="Machines kept pre-booted so a run starts instantly instead of cold-starting. 0 = always cold-start. Each ready machine is a paid VM everyone shares."
                        side="right"
                      >
                        <Info className="w-3.5 h-3.5 text-white/50 hover:text-white/80 cursor-help" />
                      </SimpleTooltip>
                      <SimpleTooltip
                        content={SCOPE_CHIP_HINTS.wholeRepo}
                        side="bottom"
                      >
                        <span className="ml-auto text-[10px] text-white/35 uppercase tracking-wide cursor-help">
                          whole repo
                        </span>
                      </SimpleTooltip>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        id="pool-min"
                        type="number"
                        min={0}
                        max={POOL_MIN_MAX}
                        step={1}
                        placeholder={`${POOL_MIN_DEFAULT}`}
                        value={poolMin}
                        onChange={(e) => setPoolMin(e.target.value)}
                        className="bg-black/30 border-white/10 w-24"
                      />
                      <span className="text-xs text-white/50">machines</span>
                    </div>
                    <Button
                      size="sm"
                      onClick={savePoolMin}
                      disabled={!poolMinHasChanges || poolMinSaving}
                    >
                      {poolMinSaving ? "Saving…" : "Save for everyone"}
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
                status={
                  <span className="flex items-center gap-1.5">
                    <StatusDot state={brainState} />
                    {STATUS_LABELS[brainState]}
                  </span>
                }
              />
              <BrainFlyCard
                headers={vaultHeaders()}
                flyTokenConfigured={flyTokenConfigured}
                onStatusChange={setBrainState}
              />
            </section>

            {/* ── LiteLLM ──────────────────────────────────────────────── */}
            <section className="space-y-3">
              <GroupHeader
                icon={Cpu}
                label="LiteLLM"
                hint="shared model proxy"
                status={
                  <span className="flex items-center gap-1.5">
                    <StatusDot state={litellmStatus.state} />
                    {STATUS_LABELS[litellmStatus.state]}
                    {litellmStatus.free != null && (
                      <span>· {litellmStatus.free} ready</span>
                    )}
                  </span>
                }
              />
              <LitellmFlyCard
                headers={vaultHeaders()}
                flyTokenConfigured={flyTokenConfigured}
                onStatusChange={setLitellmStatus}
              />
            </section>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}
