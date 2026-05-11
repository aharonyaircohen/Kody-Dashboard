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
import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  ArrowLeft,
  Brain,
  Github,
  KeyRound,
  LogOut,
  ShieldCheck,
} from "lucide-react"
import { Button } from "@dashboard/ui/button"
import { Card, CardContent } from "@dashboard/ui/card"
import { Input } from "@dashboard/ui/input"
import { Label } from "@dashboard/ui/label"
import { ConfirmDialog } from "./ConfirmDialog"
import { useAuth } from "../auth-context"

export function SettingsManager() {
  const { auth, logout, updateIntegrations } = useAuth()

  // ─── Brain config (local form state, seeded from auth) ──────────────────
  const [brainUrl, setBrainUrl] = useState("")
  const [brainKey, setBrainKey] = useState("")

  // ─── Vercel bypass secret ───────────────────────────────────────────────
  const [vercelSecret, setVercelSecret] = useState("")

  const [confirmLogout, setConfirmLogout] = useState(false)
  const [confirmClearBrain, setConfirmClearBrain] = useState(false)
  const [confirmClearVercel, setConfirmClearVercel] = useState(false)

  // Seed form state once auth loads (or repo switches).
  useEffect(() => {
    setBrainUrl(auth?.brain?.url ?? "")
    setBrainKey(auth?.brain?.apiKey ?? "")
    setVercelSecret(auth?.vercelBypassSecret ?? "")
  }, [auth?.brain?.url, auth?.brain?.apiKey, auth?.vercelBypassSecret])

  const brainHasChanges =
    brainUrl.trim() !== (auth?.brain?.url ?? "") ||
    brainKey.trim() !== (auth?.brain?.apiKey ?? "")
  const vercelHasChanges = vercelSecret.trim() !== (auth?.vercelBypassSecret ?? "")

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

  return (
    <div className="min-h-screen bg-black/95 text-white/90">
      <header className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-white/[0.06] bg-black/30">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/" aria-label="Back to dashboard">
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </Button>
          <KeyRound className="w-5 h-5 text-amber-400" />
          <h1 className="text-base md:text-lg font-semibold">Settings</h1>
          {auth?.user?.login && (
            <span className="text-[11px] text-white/40">@{auth.user.login}</span>
          )}
        </div>
      </header>

      <main className="px-4 md:px-6 py-6 max-w-3xl mx-auto space-y-4">
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
      </main>

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
    </div>
  )
}
