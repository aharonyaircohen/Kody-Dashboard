/**
 * @fileType component
 * @domain settings
 * @pattern settings-manager
 * @ai-summary User-scoped settings UI, grouped into labeled sections (Fly
 *   infrastructure, Chat & integrations, Quick links, Account). Edits the
 *   optional integration fields in localStorage.kody_auth (brain,
 *   vercelBypassSecret, flyPerf) via useAuth().updateIntegrations, and the
 *   per-repo warm-pool size (POOL_MIN) in the repo vault via /api/kody/secrets.
 *   Per-repo secrets (FLY_API_TOKEN, GitHub PATs) are managed on /secrets and
 *   /repos — surfaced here read-only / as links.
 */
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Bot,
  Brain,
  Cpu,
  Github,
  KeyRound,
  Link2,
  LogOut,
  MessageSquare,
  Rocket,
  ShieldCheck,
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
import { BrainFlyCard } from "./BrainFlyCard";
import { LitellmFlyCard } from "./LitellmFlyCard";
import { ConfirmDialog } from "./ConfirmDialog";
import { PageShell } from "./PageShell";
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

/** Section divider header — groups the cards under a quiet uppercase label. */
function SectionHeader({ icon: Icon, label }: { icon?: LucideIcon; label: string }) {
  return (
    <div className="flex items-center gap-2 px-1">
      {Icon ? <Icon className="w-3.5 h-3.5 text-white/40" /> : null}
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
        {label}
      </h2>
    </div>
  );
}

export function SettingsManager() {
  const { auth, logout, updateIntegrations } = useAuth();

  // ─── Brain config (local form state, seeded from auth) ──────────────────
  const [brainUrl, setBrainUrl] = useState("");
  const [brainKey, setBrainKey] = useState("");

  // ─── Vercel bypass secret ───────────────────────────────────────────────
  const [vercelSecret, setVercelSecret] = useState("");

  // ─── Fly Machines perf tier ─────────────────────────────────────────────
  // The Fly token itself is NOT edited here — it lives in the repo vault
  // (.kody/secrets.enc → FLY_API_TOKEN) and is managed on the Secrets page,
  // the single source of truth. This card only owns the perf tier (per-user
  // localStorage via auth-context) and probes the vault read-only so the
  // Brain-on-Fly card knows whether a token is configured.
  const [flyTokenConfigured, setFlyTokenConfigured] = useState(false);
  const [flyPerf, setFlyPerf] = useState<FlyPerfTier>(FLY_PERF_DEFAULT);

  // ─── Warm pool size (per-repo, vault POOL_MIN) ──────────────────────────
  // Stored in the repo vault because the always-on pool owner reads the vault
  // (it has no other per-repo store). Empty string = unset → engine default.
  const [poolMin, setPoolMin] = useState("");
  const [poolMinSaved, setPoolMinSaved] = useState("");
  const [poolMinSaving, setPoolMinSaving] = useState(false);

  const [confirmLogout, setConfirmLogout] = useState(false);
  const [confirmClearBrain, setConfirmClearBrain] = useState(false);
  const [confirmClearVercel, setConfirmClearVercel] = useState(false);

  // Read-only probe: is FLY_API_TOKEN present in the per-repo vault? Re-runs
  // whenever auth (and therefore the connected repo) changes.
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

  // Load the current warm-pool size from the repo vault (absent → blank input).
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

  // Seed form state once auth loads (or repo switches).
  useEffect(() => {
    setBrainUrl(auth?.brain?.url ?? "");
    setBrainKey(auth?.brain?.apiKey ?? "");
    setVercelSecret(auth?.vercelBypassSecret ?? "");
    setFlyPerf(auth?.flyPerf ?? FLY_PERF_DEFAULT);
    void probeFlyToken();
    void loadPoolMin();
  }, [
    auth?.brain?.url,
    auth?.brain?.apiKey,
    auth?.vercelBypassSecret,
    auth?.flyPerf,
    auth?.owner,
    auth?.repo,
    probeFlyToken,
    loadPoolMin,
  ]);

  const brainHasChanges =
    brainUrl.trim() !== (auth?.brain?.url ?? "") ||
    brainKey.trim() !== (auth?.brain?.apiKey ?? "");
  const vercelHasChanges =
    vercelSecret.trim() !== (auth?.vercelBypassSecret ?? "");
  const flyHasChanges = flyPerf !== (auth?.flyPerf ?? FLY_PERF_DEFAULT);
  const poolMinHasChanges = poolMin.trim() !== poolMinSaved.trim();

  function saveBrain() {
    const url = brainUrl.trim();
    const key = brainKey.trim();
    if (!url || !key) {
      toast.error("Brain URL and API key are both required");
      return;
    }
    updateIntegrations({ brain: { url, apiKey: key } });
    toast.success("Brain config saved");
  }

  function clearBrain() {
    updateIntegrations({ brain: null });
    setBrainUrl("");
    setBrainKey("");
    setConfirmClearBrain(false);
    toast.success("Brain config cleared");
  }

  function saveVercel() {
    const secret = vercelSecret.trim();
    if (!secret) {
      toast.error("Bypass secret cannot be empty — use Clear to remove it");
      return;
    }
    updateIntegrations({ vercelBypassSecret: secret });
    toast.success("Vercel bypass secret saved");
  }

  function clearVercel() {
    updateIntegrations({ vercelBypassSecret: null });
    setVercelSecret("");
    setConfirmClearVercel(false);
    toast.success("Vercel bypass secret cleared");
  }

  function saveFly() {
    // Perf tier only — the token is managed on the Secrets page.
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
        body: JSON.stringify({
          name: POOL_MIN_VAULT_KEY,
          value: String(n),
          actorLogin: auth?.user?.login,
        }),
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
      title="Settings"
      icon={KeyRound}
      iconClassName="text-amber-400"
      subtitle={auth?.user?.login ? `@${auth.user.login}` : undefined}
    >
      <div className="space-y-6">
        {/* ═══ Fly infrastructure ═══════════════════════════════════════ */}
        <section className="space-y-3">
          <SectionHeader icon={Rocket} label="Fly infrastructure" />

          {/* Fly Runner: perf tier + warm pool size + token status */}
          <Card className="border-white/[0.08] bg-white/[0.03]">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center gap-2">
                <Rocket className="w-4 h-4 text-sky-400" />
                <h2 className="text-sm font-semibold">Fly Runner</h2>
              </div>
              <p className="text-xs text-white/50 -mt-2">
                Runs chat/issue agents on Fly.io instead of GitHub Actions. The
                Fly Machines API token lives in the{" "}
                <a href="/secrets" className="text-sky-400 hover:underline">
                  Secrets
                </a>{" "}
                page as <span className="font-mono">FLY_API_TOKEN</span> —{" "}
                {flyTokenConfigured ? "configured." : "not set yet."}
              </p>

              {/* Performance tier (per-user, localStorage) */}
              <div className="space-y-2">
                <Label htmlFor="fly-perf" className="text-xs text-white/70">
                  Performance tier
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
                <div className="pt-1">
                  <Button size="sm" onClick={saveFly} disabled={!flyHasChanges}>
                    Save tier
                  </Button>
                </div>
              </div>

              <div className="h-px bg-white/[0.06]" />

              {/* Warm pool size (per-repo, vault POOL_MIN) */}
              <div className="space-y-2">
                <Label htmlFor="pool-min" className="text-xs text-white/70">
                  Warm pool size
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
                <p className="text-[11px] text-white/45 leading-snug">
                  Machines kept pre-booted and frozen so a chat/issue run claims
                  one instantly instead of cold-starting. {POOL_MIN_DEFAULT} by
                  default, up to {POOL_MIN_MAX}. Each warm machine is a paid Fly
                  VM; set 0 to always cold-start.{" "}
                  {flyTokenConfigured
                    ? "Resizing takes effect within ~1 minute."
                    : "Takes effect once FLY_API_TOKEN is set on the Secrets page."}
                </p>
                <div className="pt-1">
                  <Button
                    size="sm"
                    onClick={savePoolMin}
                    disabled={!poolMinHasChanges || poolMinSaving}
                  >
                    {poolMinSaving ? "Saving…" : "Save size"}
                  </Button>
                </div>
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
        </section>

        {/* ═══ Chat & integrations ══════════════════════════════════════ */}
        <section className="space-y-3">
          <SectionHeader icon={MessageSquare} label="Chat & integrations" />

          {/* Brain server */}
          <Card className="border-white/[0.08] bg-white/[0.03]">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-violet-400" />
                <h2 className="text-sm font-semibold">Brain server</h2>
              </div>
              <p className="text-xs text-white/50 -mt-2">
                Optional external chat backend. Used when an agent routes to the
                Brain (see the agent picker in chat).
              </p>
              <div className="space-y-2">
                <Label htmlFor="brain-url" className="text-xs text-white/70">
                  URL
                </Label>
                <Input
                  id="brain-url"
                  placeholder="https://brain.example.com"
                  value={brainUrl}
                  onChange={(e) => setBrainUrl(e.target.value)}
                  className="bg-black/30 border-white/10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="brain-key" className="text-xs text-white/70">
                  API key
                </Label>
                <Input
                  id="brain-key"
                  type="password"
                  placeholder="••••••••"
                  value={brainKey}
                  onChange={(e) => setBrainKey(e.target.value)}
                  className="bg-black/30 border-white/10 font-mono"
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={saveBrain}
                  disabled={!brainHasChanges}
                >
                  Save
                </Button>
                {auth?.brain && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmClearBrain(true)}
                    className="text-rose-300 hover:text-rose-200"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Vercel preview bypass */}
          <Card className="border-white/[0.08] bg-white/[0.03]">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-semibold">Vercel preview bypass</h2>
              </div>
              <p className="text-xs text-white/50 -mt-2">
                Vercel &quot;Protection Bypass for Automation&quot; secret. Lets
                the dashboard embed protected preview deployments in the iframe.
              </p>
              <div className="space-y-2">
                <Label
                  htmlFor="vercel-secret"
                  className="text-xs text-white/70"
                >
                  Secret
                </Label>
                <Input
                  id="vercel-secret"
                  type="password"
                  placeholder="••••••••"
                  value={vercelSecret}
                  onChange={(e) => setVercelSecret(e.target.value)}
                  className="bg-black/30 border-white/10 font-mono"
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={saveVercel}
                  disabled={!vercelHasChanges}
                >
                  Save
                </Button>
                {auth?.vercelBypassSecret && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmClearVercel(true)}
                    className="text-rose-300 hover:text-rose-200"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </section>

        {/* ═══ Quick links ══════════════════════════════════════════════ */}
        <section className="space-y-3">
          <SectionHeader icon={Link2} label="Quick links" />
          <Card className="border-white/[0.08] bg-white/[0.02]">
            <CardContent className="p-4">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  asChild
                  variant="outline"
                  className="justify-start gap-2 bg-white/[0.02] border-white/10 hover:bg-white/[0.06]"
                >
                  <Link href="/models">
                    <Cpu className="w-4 h-4" />
                    Chat models
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="justify-start gap-2 bg-white/[0.02] border-white/10 hover:bg-white/[0.06]"
                >
                  <Link href="/prompts">
                    <Bot className="w-4 h-4" />
                    Slash prompts
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="justify-start gap-2 bg-white/[0.02] border-white/10 hover:bg-white/[0.06]"
                >
                  <Link href="/repos">
                    <Github className="w-4 h-4" />
                    Repositories
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="justify-start gap-2 bg-white/[0.02] border-white/10 hover:bg-white/[0.06]"
                >
                  <Link href="/secrets">
                    <KeyRound className="w-4 h-4" />
                    Secrets vault
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* ═══ Account ══════════════════════════════════════════════════ */}
        <section className="space-y-3">
          <SectionHeader icon={LogOut} label="Account" />
          <Card className="border-rose-500/20 bg-rose-950/10">
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Sign out</p>
                <p className="text-xs text-white/50 mt-0.5">
                  Clears all stored credentials for this browser.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmLogout(true)}
                className="gap-1 border-rose-500/30 text-rose-200 hover:bg-rose-500/10"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </Button>
            </CardContent>
          </Card>
        </section>
      </div>

      <ConfirmDialog
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        title="Sign out?"
        description="This clears every stored credential in this browser (GitHub tokens, Brain config, Vercel bypass)."
        confirmLabel="Sign out"
        variant="destructive"
        onConfirm={() => logout()}
      />
      <ConfirmDialog
        open={confirmClearBrain}
        onClose={() => setConfirmClearBrain(false)}
        title="Clear Brain config?"
        description="Removes the saved Brain URL and API key from this browser."
        confirmLabel="Clear"
        variant="destructive"
        onConfirm={clearBrain}
      />
      <ConfirmDialog
        open={confirmClearVercel}
        onClose={() => setConfirmClearVercel(false)}
        title="Clear Vercel bypass?"
        description="Removes the saved Vercel preview bypass secret from this browser."
        confirmLabel="Clear"
        variant="destructive"
        onConfirm={clearVercel}
      />
    </PageShell>
  );
}
