/**
 * @fileType component
 * @domain runner
 * @pattern runner-manager
 * @ai-summary Per-repo Fly runner configuration. Owns the repo-scoped Fly
 *   infrastructure knobs that are shared across everyone on the repo (NOT
 *   per-user — those live on /settings): the warm-pool size (POOL_MIN vault
 *   secret, read by the always-on pool owner), plus read-only status for the
 *   FLY_API_TOKEN probe, the LiteLLM proxy, and Brain-on-Fly. The Fly token
 *   itself is set on /secrets; the per-user perf tier stays on /settings.
 */
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Rocket, Server } from "lucide-react";
import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";
import { BrainFlyCard } from "./BrainFlyCard";
import { LitellmFlyCard } from "./LitellmFlyCard";
import { PageShell } from "./PageShell";
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

export function RunnerManager() {
  // Read-only probe: is FLY_API_TOKEN present in the per-repo vault?
  const [flyTokenConfigured, setFlyTokenConfigured] = useState(false);

  // Warm pool size — per-repo, stored as the POOL_MIN vault secret (the only
  // store the always-on pool owner can read). Empty string = unset → engine
  // default.
  const [poolMin, setPoolMin] = useState("");
  const [poolMinSaved, setPoolMinSaved] = useState("");
  const [poolMinSaving, setPoolMinSaving] = useState(false);

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

  const poolMinHasChanges = poolMin.trim() !== poolMinSaved.trim();

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
      subtitle="Per-repo Fly infrastructure — shared across everyone on this repo"
    >
      <div className="space-y-4">
        {/* ─── Fly Machines token (read-only status) ──────────────────── */}
        <Card className="border-white/[0.08] bg-white/[0.03]">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-sky-400" />
              <h2 className="text-sm font-semibold">Fly Machines token</h2>
            </div>
            <p className="text-xs text-white/50">
              Runs chat/issue agents on Fly.io instead of GitHub Actions. Set{" "}
              <span className="font-mono">FLY_API_TOKEN</span> on the{" "}
              <Link href="/secrets" className="text-sky-400 hover:underline">
                Secrets
              </Link>{" "}
              page — currently{" "}
              {flyTokenConfigured ? (
                <span className="text-emerald-300">configured</span>
              ) : (
                <span className="text-amber-300">not set</span>
              )}
              . Without it, every Fly feature below falls back to GitHub
              Actions.
            </p>
          </CardContent>
        </Card>

        {/* ─── Warm pool size ─────────────────────────────────────────── */}
        <Card className="border-white/[0.08] bg-white/[0.03]">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-sky-400" />
              <h2 className="text-sm font-semibold">Warm pool size</h2>
            </div>
            <p className="text-xs text-white/50">
              Machines kept pre-booted and frozen so a chat/issue run claims one
              instantly instead of cold-starting. {POOL_MIN_DEFAULT} by default,
              up to {POOL_MIN_MAX}. Each warm machine is a paid Fly VM; set 0 to
              always cold-start.{" "}
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

        {/* ─── LiteLLM proxy status (read-only) ───────────────────────── */}
        <LitellmFlyCard
          headers={vaultHeaders()}
          flyTokenConfigured={flyTokenConfigured}
        />

        {/* ─── Brain on Fly toggle ────────────────────────────────────── */}
        <BrainFlyCard
          headers={vaultHeaders()}
          flyTokenConfigured={flyTokenConfigured}
        />
      </div>
    </PageShell>
  );
}
