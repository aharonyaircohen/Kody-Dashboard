/**
 * @fileType component
 * @domain settings
 * @pattern settings-manager
 * @ai-summary User-scoped credentials UI. Edits the optional integration
 *   fields stored in localStorage.kody_auth (brain, vercelBypassSecret) and
 *   links over to /repos (GitHub PAT rotation) and /secrets (per-repo vault).
 *   Persistence flows through useAuth().updateIntegrations so this component
 *   never touches localStorage directly.
 */
"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Brain, Github, KeyRound, LogOut, Rocket, ShieldCheck } from "lucide-react"
import { Button } from "@dashboard/ui/button"
import { Card, CardContent } from "@dashboard/ui/card"
import { Input } from "@dashboard/ui/input"
import { Label } from "@dashboard/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dashboard/ui/select"
import { ConfirmDialog } from "./ConfirmDialog"
import { PageShell } from "./PageShell"
import { useAuth, type FlyPerfTier } from "../auth-context"
import { getStoredAuth } from "../api"

/** Vault key under which the project-scoped Fly Machines token is stored. */
const FLY_VAULT_KEY = "FLY_API_TOKEN"

function vaultHeaders(): Record<string, string> {
  const auth = getStoredAuth()
  return auth
    ? {
        "x-kody-token": auth.token,
        "x-kody-owner": auth.owner,
        "x-kody-repo": auth.repo,
      }
    : {}
}

const FLY_PERF_DEFAULT: FlyPerfTier = "medium"

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
}

export function SettingsManager() {
  const { auth, logout, updateIntegrations } = useAuth()

  // ─── Brain config (local form state, seeded from auth) ──────────────────
  const [brainUrl, setBrainUrl] = useState("")
  const [brainKey, setBrainKey] = useState("")

  // ─── Brain-on-Fly status (queried from /api/kody/brain/status) ──────────
  type BrainFlyState = "off" | "running" | "suspended" | "stopped" | "unknown"
  const [brainFlyState, setBrainFlyState] = useState<BrainFlyState>("unknown")
  const [brainFlyBusy, setBrainFlyBusy] = useState<"idle" | "provisioning" | "destroying">("idle")

  // ─── Vercel bypass secret ───────────────────────────────────────────────
  const [vercelSecret, setVercelSecret] = useState("")

  // ─── Fly Machines API token + perf tier ─────────────────────────────────
  // Token lives in the repo vault (.kody/secrets.enc → FLY_API_TOKEN) so it
  // is project-scoped instead of per-browser. Perf tier stays per-user in
  // localStorage via auth-context, so the card behaves as before: edits to
  // either are committed together when Save is clicked.
  const [flyToken, setFlyToken] = useState("")
  const [savedFlyToken, setSavedFlyToken] = useState("")
  const [flyPerf, setFlyPerf] = useState<FlyPerfTier>(FLY_PERF_DEFAULT)

  const [confirmLogout, setConfirmLogout] = useState(false)
  const [confirmClearBrain, setConfirmClearBrain] = useState(false)
  const [confirmClearVercel, setConfirmClearVercel] = useState(false)
  const [confirmClearFly, setConfirmClearFly] = useState(false)

  // Load FLY_API_TOKEN from the per-repo vault. Re-runs whenever auth (and
  // therefore the connected repo) changes.
  const loadFlyToken = useCallback(async () => {
    const headers = vaultHeaders()
    if (Object.keys(headers).length === 0) {
      setSavedFlyToken("")
      setFlyToken("")
      return
    }
    try {
      const res = await fetch(
        `/api/kody/secrets/${FLY_VAULT_KEY}/value`,
        { headers },
      )
      if (res.status === 404) {
        setSavedFlyToken("")
        setFlyToken("")
        return
      }
      if (!res.ok) return
      const body = (await res.json()) as { value?: string }
      const v = body.value ?? ""
      setSavedFlyToken(v)
      setFlyToken(v)
    } catch {
      // Network/vault errors leave the field empty — same UX as no token.
    }
  }, [])

  // Seed form state once auth loads (or repo switches).
  useEffect(() => {
    setBrainUrl(auth?.brain?.url ?? "")
    setBrainKey(auth?.brain?.apiKey ?? "")
    setVercelSecret(auth?.vercelBypassSecret ?? "")
    setFlyPerf(auth?.flyPerf ?? FLY_PERF_DEFAULT)
    void loadFlyToken()
  }, [
    auth?.brain?.url,
    auth?.brain?.apiKey,
    auth?.vercelBypassSecret,
    auth?.flyPerf,
    auth?.owner,
    auth?.repo,
    loadFlyToken,
  ])

  // ─── Brain-on-Fly: status check ─────────────────────────────────────────
  // Polls /api/kody/brain/status whenever the user has a saved Fly token —
  // before that the server returns "off" without hitting the Fly API, so
  // there's no point asking. The status drives the pill + which buttons
  // we render under the URL/key fields.
  const refreshBrainFlyStatus = useCallback(async () => {
    const headers = vaultHeaders()
    if (Object.keys(headers).length === 0 || !savedFlyToken) {
      setBrainFlyState("off")
      return
    }
    try {
      const res = await fetch("/api/kody/brain/status", { headers })
      if (!res.ok) {
        setBrainFlyState("unknown")
        return
      }
      const body = (await res.json()) as { state?: BrainFlyState }
      setBrainFlyState(body.state ?? "unknown")
    } catch {
      setBrainFlyState("unknown")
    }
  }, [savedFlyToken])

  useEffect(() => {
    void refreshBrainFlyStatus()
  }, [refreshBrainFlyStatus])

  async function provisionBrainOnFly() {
    const headers = vaultHeaders()
    if (Object.keys(headers).length === 0) {
      toast.error("Sign in to a repo before provisioning")
      return
    }
    if (!savedFlyToken) {
      toast.error("Save a Fly token in the Fly Runner card first")
      return
    }
    setBrainFlyBusy("provisioning")
    try {
      const res = await fetch("/api/kody/brain/provision", {
        method: "POST",
        headers,
      })
      const body = (await res.json().catch(() => ({}))) as {
        url?: string
        apiKey?: string
        error?: string
      }
      if (!res.ok) {
        toast.error(body.error ?? `Provision failed (HTTP ${res.status})`)
        return
      }
      if (!body.url || !body.apiKey) {
        toast.error("Provision returned no URL or API key")
        return
      }
      setBrainUrl(body.url)
      setBrainKey(body.apiKey)
      updateIntegrations({ brain: { url: body.url, apiKey: body.apiKey } })
      toast.success("Brain provisioned on Fly — URL + key saved")
      await refreshBrainFlyStatus()
    } catch (err) {
      toast.error(`Provision failed: ${(err as Error).message}`)
    } finally {
      setBrainFlyBusy("idle")
    }
  }

  async function destroyBrainOnFly() {
    const headers = vaultHeaders()
    if (Object.keys(headers).length === 0) return
    setBrainFlyBusy("destroying")
    try {
      const res = await fetch("/api/kody/brain/destroy", {
        method: "POST",
        headers,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(body.error ?? `Destroy failed (HTTP ${res.status})`)
        return
      }
      // Clear the saved Brain URL/key — the destroyed machine's key is now
      // useless. The user can re-provision later (auto-fills fresh values).
      updateIntegrations({ brain: null })
      setBrainUrl("")
      setBrainKey("")
      toast.success("Brain destroyed on Fly")
      await refreshBrainFlyStatus()
    } catch (err) {
      toast.error(`Destroy failed: ${(err as Error).message}`)
    } finally {
      setBrainFlyBusy("idle")
    }
  }

  const brainHasChanges =
    brainUrl.trim() !== (auth?.brain?.url ?? "") ||
    brainKey.trim() !== (auth?.brain?.apiKey ?? "")
  const vercelHasChanges = vercelSecret.trim() !== (auth?.vercelBypassSecret ?? "")
  const flyHasChanges =
    flyToken.trim() !== savedFlyToken ||
    flyPerf !== (auth?.flyPerf ?? FLY_PERF_DEFAULT)

  function saveBrain() {
    const url = brainUrl.trim()
    const key = brainKey.trim()
    if (!url || !key) {
      toast.error("Brain URL and API key are both required")
      return
    }
    updateIntegrations({ brain: { url, apiKey: key } })
    toast.success("Brain config saved")
  }

  function clearBrain() {
    updateIntegrations({ brain: null })
    setBrainUrl("")
    setBrainKey("")
    setConfirmClearBrain(false)
    toast.success("Brain config cleared")
  }

  function saveVercel() {
    const secret = vercelSecret.trim()
    if (!secret) {
      toast.error("Bypass secret cannot be empty — use Clear to remove it")
      return
    }
    updateIntegrations({ vercelBypassSecret: secret })
    toast.success("Vercel bypass secret saved")
  }

  function clearVercel() {
    updateIntegrations({ vercelBypassSecret: null })
    setVercelSecret("")
    setConfirmClearVercel(false)
    toast.success("Vercel bypass secret cleared")
  }

  async function saveFly() {
    const tok = flyToken.trim()
    if (!tok) {
      toast.error("Fly token cannot be empty — use Clear to remove it")
      return
    }
    const headers = vaultHeaders()
    if (Object.keys(headers).length === 0) {
      toast.error("Sign in to a repo before saving Fly settings")
      return
    }
    // Token → repo vault; perf tier stays per-user in localStorage. Save
    // both in one click so the card behaves as before.
    const tokenChanged = tok !== savedFlyToken
    try {
      if (tokenChanged) {
        const res = await fetch("/api/kody/secrets", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: FLY_VAULT_KEY,
            value: tok,
            actorLogin: auth?.user?.login,
          }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string }
          toast.error(body.message ?? `Save failed (HTTP ${res.status})`)
          return
        }
        setSavedFlyToken(tok)
      }
      updateIntegrations({
        flyPerf: flyPerf === FLY_PERF_DEFAULT ? null : flyPerf,
      })
      toast.success("Fly settings saved")
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`)
    }
  }

  async function clearFly() {
    const headers = vaultHeaders()
    if (savedFlyToken && Object.keys(headers).length > 0) {
      try {
        const res = await fetch(`/api/kody/secrets/${FLY_VAULT_KEY}`, {
          method: "DELETE",
          headers,
        })
        if (!res.ok && res.status !== 404) {
          const body = (await res.json().catch(() => ({}))) as { message?: string }
          toast.error(body.message ?? `Clear failed (HTTP ${res.status})`)
          return
        }
      } catch (err) {
        toast.error(`Clear failed: ${(err as Error).message}`)
        return
      }
    }
    updateIntegrations({ flyPerf: null })
    setFlyToken("")
    setSavedFlyToken("")
    setFlyPerf(FLY_PERF_DEFAULT)
    setConfirmClearFly(false)
    toast.success("Fly settings cleared")
  }

  return (
    <PageShell
      title="Settings"
      icon={KeyRound}
      iconClassName="text-amber-400"
      subtitle={auth?.user?.login ? `@${auth.user.login}` : undefined}
    >
      <div className="space-y-4">
        {/* ─── Brain config ───────────────────────────────────────────── */}
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
              <Button size="sm" onClick={saveBrain} disabled={!brainHasChanges}>
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

            {/* ─── Host on Fly (auto-fills URL + key above) ────────── */}
            <div className="pt-4 mt-2 border-t border-white/[0.06] space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <h3 className="text-xs font-semibold text-white/80">
                    Host on Fly
                  </h3>
                  <p className="text-[11px] text-white/45 leading-snug">
                    Provision a per-user Brain server on Fly.io that wraps the
                    Kody engine. Requires the Fly Runner token below. Returns
                    a URL + API key that auto-fill the fields above.
                  </p>
                </div>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wide ${
                    brainFlyState === "running"
                      ? "bg-emerald-500/15 text-emerald-300"
                      : brainFlyState === "suspended"
                        ? "bg-amber-500/15 text-amber-300"
                        : brainFlyState === "stopped"
                          ? "bg-rose-500/15 text-rose-300"
                          : "bg-white/5 text-white/40"
                  }`}
                >
                  {brainFlyState === "unknown" ? "—" : brainFlyState}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={provisionBrainOnFly}
                  disabled={
                    brainFlyBusy !== "idle" ||
                    !savedFlyToken ||
                    brainFlyState === "running" ||
                    brainFlyState === "suspended"
                  }
                >
                  {brainFlyBusy === "provisioning" ? "Provisioning…" : "Provision"}
                </Button>
                {(brainFlyState === "running" ||
                  brainFlyState === "suspended" ||
                  brainFlyState === "stopped") && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={destroyBrainOnFly}
                    disabled={brainFlyBusy !== "idle"}
                    className="text-rose-300 hover:text-rose-200"
                  >
                    {brainFlyBusy === "destroying" ? "Destroying…" : "Destroy"}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={refreshBrainFlyStatus}
                  disabled={brainFlyBusy !== "idle"}
                  className="text-white/50 hover:text-white/80"
                >
                  Refresh
                </Button>
              </div>
              {!savedFlyToken && (
                <p className="text-[11px] text-white/40 italic">
                  Save a Fly token in the Fly Runner card below to enable
                  provisioning.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ─── Vercel bypass ──────────────────────────────────────────── */}
        <Card className="border-white/[0.08] bg-white/[0.03]">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-semibold">Vercel preview bypass</h2>
            </div>
            <p className="text-xs text-white/50 -mt-2">
              Vercel &quot;Protection Bypass for Automation&quot; secret. Lets the
              dashboard embed protected preview deployments in the iframe.
            </p>
            <div className="space-y-2">
              <Label htmlFor="vercel-secret" className="text-xs text-white/70">
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
              <Button size="sm" onClick={saveVercel} disabled={!vercelHasChanges}>
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

        {/* ─── Fly Runner token ───────────────────────────────────────── */}
        <Card className="border-white/[0.08] bg-white/[0.03]">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Rocket className="w-4 h-4 text-sky-400" />
              <h2 className="text-sm font-semibold">Fly Runner</h2>
            </div>
            <p className="text-xs text-white/50 -mt-2">
              Fly Machines API token. Lets the dashboard spawn the kody-live-fly
              runner on Fly.io as an alternative to GitHub Actions. Create one
              at fly.io → Tokens, scoped to the kody-runner app.
            </p>
            <div className="space-y-2">
              <Label htmlFor="fly-token" className="text-xs text-white/70">
                API token
              </Label>
              <Input
                id="fly-token"
                type="password"
                placeholder="fo1_..."
                value={flyToken}
                onChange={(e) => setFlyToken(e.target.value)}
                className="bg-black/30 border-white/10 font-mono"
              />
            </div>
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
                  <SelectItem value="low">{FLY_PERF_LABELS.low.label}</SelectItem>
                  <SelectItem value="medium">{FLY_PERF_LABELS.medium.label}</SelectItem>
                  <SelectItem value="high">{FLY_PERF_LABELS.high.label}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-white/45 leading-snug">
                {FLY_PERF_LABELS[flyPerf].hint}
              </p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" onClick={saveFly} disabled={!flyHasChanges}>
                Save
              </Button>
              {savedFlyToken && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmClearFly(true)}
                  className="text-rose-300 hover:text-rose-200"
                >
                  Clear
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ─── Pointers to per-repo concerns ──────────────────────────── */}
        <Card className="border-white/[0.08] bg-white/[0.02]">
          <CardContent className="p-4 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-white/50">
              Related
            </h2>
            <div className="grid gap-2">
              <Button
                asChild
                variant="outline"
                className="justify-start gap-2 bg-white/[0.02] border-white/10 hover:bg-white/[0.06]"
              >
                <Link href="/repos">
                  <Github className="w-4 h-4" />
                  Repositories &amp; GitHub tokens
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="justify-start gap-2 bg-white/[0.02] border-white/10 hover:bg-white/[0.06]"
              >
                <Link href="/secrets">
                  <KeyRound className="w-4 h-4" />
                  Repo secrets vault
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ─── Sign out ───────────────────────────────────────────────── */}
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
      <ConfirmDialog
        open={confirmClearFly}
        onClose={() => setConfirmClearFly(false)}
        title="Clear Fly token?"
        description="Removes the saved Fly Machines API token from this browser. kody-live-fly sessions will fail until a new token is saved — the dashboard does not fall back to a server env var."
        confirmLabel="Clear"
        variant="destructive"
        onConfirm={clearFly}
      />
    </PageShell>
  )
}
