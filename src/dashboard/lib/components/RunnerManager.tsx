/**
 * @fileType component
 * @domain runner
 * @pattern fly-pages
 * @ai-summary Shared Fly page shell for /fly/config, /fly/machines, and
 * /fly/history. Config owns settings; machines owns live inventory; history
 * owns activity snapshots.
 */
"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
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
import { BrainFlyCard, type BrainFlyState } from "./BrainFlyCard";
import { FlyActivityTab } from "./FlyActivityTab";
import { FlyMachinesTable } from "./FlyMachinesTable";
import { PreviewsCard } from "./PreviewsCard";
import { PageShell } from "./PageShell";
import { SimpleTooltip } from "./SimpleTooltip";
import { VaultLockedBanner } from "./VaultLockedBanner";
import { useAuth, type FlyPerfTier } from "../auth-context";

const FLY_VAULT_KEY = "FLY_API_TOKEN";
const POOL_MIN_VAULT_KEY = "POOL_MIN";
const POOL_MIN_DEFAULT = 2;
const POOL_MIN_MAX = 10;
const FLY_PERF_DEFAULT: FlyPerfTier = "medium";
const EMPTY_HEADERS: Record<string, string> = {};

const FLY_PERF_LABELS: Record<FlyPerfTier, { label: string; hint: string }> = {
  low: {
    label: "Economy",
    hint: "Cheapest (shared 2x / 2 GB). Fine for chat; installs and tests are slower.",
  },
  medium: {
    label: "Balanced",
    hint: "Default (performance 1x / 2 GB). Good for most Vibe and build-test work.",
  },
  high: {
    label: "Fast",
    hint: "Fastest (performance 2x / 4 GB). Best for heavy installs and big repos. Costs more.",
  },
};

const PERF_ORDER: FlyPerfTier[] = ["low", "medium", "high"];

const SCOPE_CHIP_HINTS = {
  wholeRepo: "Applies to everyone using this repo.",
  justYou: "Only affects this browser.",
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
  unknown: "-",
};

export type RunnerView = "config" | "machines" | "history";

interface RunnerManagerProps {
  view?: RunnerView;
}

const FLY_VIEW_COPY: Record<RunnerView, { title: string; subtitle: string }> = {
  config: {
    title: "Fly Config",
    subtitle: "Rules and sizes for Fly preview and runner work.",
  },
  machines: {
    title: "Fly Machines",
    subtitle: "Live Fly machines and actions.",
  },
  history: {
    title: "Fly History",
    subtitle: "Past Fly machine activity from state snapshots.",
  },
};

function StatusDot({ state }: { state: string }) {
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full inline-block ${
        STATUS_DOT_COLORS[state] ?? STATUS_DOT_COLORS.unknown
      }`}
    />
  );
}

function GroupHeader({
  icon: Icon,
  label,
  hint,
  status,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  status?: ReactNode;
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

function useFlyTokenConfigured(headers: Record<string, string>): boolean {
  const [flyTokenConfigured, setFlyTokenConfigured] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function probeFlyToken() {
      if (Object.keys(headers).length === 0) {
        if (!cancelled) setFlyTokenConfigured(false);
        return;
      }
      try {
        const res = await fetch(`/api/kody/secrets/${FLY_VAULT_KEY}/value`, {
          headers,
        });
        if (!res.ok) {
          if (!cancelled) setFlyTokenConfigured(false);
          return;
        }
        const body = (await res.json()) as { value?: string };
        if (!cancelled) setFlyTokenConfigured(Boolean(body.value));
      } catch {
        if (!cancelled) setFlyTokenConfigured(false);
      }
    }

    void probeFlyToken();

    return () => {
      cancelled = true;
    };
  }, [headers]);

  return flyTokenConfigured;
}

function FlyTokenCard({ flyTokenConfigured }: { flyTokenConfigured: boolean }) {
  return (
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
                <Link href="/secrets" className="text-sky-400 hover:underline">
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
            className={`ml-auto text-[11px] ${
              flyTokenConfigured ? "text-emerald-300" : "text-amber-300"
            }`}
          >
            {flyTokenConfigured ? "configured" : "not set"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function RunnerConfigView({
  flyTokenConfigured,
  headers,
}: {
  flyTokenConfigured: boolean;
  headers: Record<string, string>;
}) {
  const { auth, updateIntegrations } = useAuth();
  const [poolMin, setPoolMin] = useState("");
  const [poolMinSaved, setPoolMinSaved] = useState("");
  const [poolMinSaving, setPoolMinSaving] = useState(false);
  const [flyPerf, setFlyPerf] = useState<FlyPerfTier>(FLY_PERF_DEFAULT);
  const [brainState, setBrainState] = useState<BrainFlyState>("unknown");

  const loadPoolMin = useCallback(async () => {
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
  }, [headers]);

  useEffect(() => {
    void loadPoolMin();
  }, [loadPoolMin]);

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
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ name: POOL_MIN_VAULT_KEY, value: String(n) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(body.message ?? `Save failed (${res.status})`);
      }
      setPoolMinSaved(String(n));
      setPoolMin(String(n));
      toast.success("Warm pool size saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPoolMinSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <FlyTokenCard flyTokenConfigured={flyTokenConfigured} />

      {flyTokenConfigured && (
        <>
          <section className="space-y-3">
            <GroupHeader
              icon={Globe}
              label="Previews"
              hint="temporary sites built for each PR"
            />
            <PreviewsCard
              headers={headers}
              flyTokenConfigured={flyTokenConfigured}
            />
          </section>

          <section className="space-y-3">
            <GroupHeader
              icon={Server}
              label="Task runners"
              hint="machines that run chat and Vibe tasks"
            />
            <Card className="border-white/[0.08] bg-white/[0.03]">
              <CardContent className="p-4 space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-sky-400" />
                    <h2 className="text-sm font-semibold">Warm pool size</h2>
                    <SimpleTooltip
                      content="How many pre-warmed runner machines to keep ready for this repo."
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
                      value={poolMin}
                      onChange={(e) => setPoolMin(e.target.value)}
                      placeholder={String(POOL_MIN_DEFAULT)}
                      inputMode="numeric"
                      className="w-24"
                    />
                    <Button
                      size="sm"
                      onClick={savePoolMin}
                      disabled={!poolMinHasChanges || poolMinSaving}
                    >
                      Save pool
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Rocket className="w-4 h-4 text-sky-400" />
                    <h2 className="text-sm font-semibold">Speed of my runs</h2>
                    <SimpleTooltip
                      content="Pick the VM size for your chat and Vibe runs. Hover each tier for the spec."
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
                  <Button size="sm" onClick={saveFly} disabled={!flyHasChanges}>
                    Save my speed
                  </Button>
                </div>
              </CardContent>
            </Card>
          </section>

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
              headers={headers}
              flyTokenConfigured={flyTokenConfigured}
              onStatusChange={setBrainState}
            />
          </section>
        </>
      )}
    </div>
  );
}

export function RunnerManager({ view = "config" }: RunnerManagerProps) {
  const { auth } = useAuth();
  const headers = useMemo<Record<string, string>>(() => {
    if (!auth) return EMPTY_HEADERS;
    return {
      "x-kody-token": auth.token,
      "x-kody-owner": auth.owner,
      "x-kody-repo": auth.repo,
    };
  }, [auth]);
  const flyTokenConfigured = useFlyTokenConfigured(headers);
  const copy = FLY_VIEW_COPY[view];

  return (
    <PageShell
      title={copy.title}
      icon={Rocket}
      iconClassName="text-sky-400"
      subtitle={copy.subtitle}
    >
      <div className="space-y-4">
        <VaultLockedBanner feature="Fly runners and previews stay off until the vault can be read." />

        {view === "config" && (
          <RunnerConfigView
            headers={headers}
            flyTokenConfigured={flyTokenConfigured}
          />
        )}

        {view === "machines" && (
          <FlyMachinesTable
            headers={headers}
            flyTokenConfigured={flyTokenConfigured}
          />
        )}

        {view === "history" && (
          <FlyActivityTab
            headers={headers}
            flyTokenConfigured={flyTokenConfigured}
          />
        )}
      </div>
    </PageShell>
  );
}
