"use client"
/**
 * @fileType component
 * @domain kody
 * @pattern push-card
 * @ai-summary Full-width push notification card for the /notifications page.
 *   Mirrors the inline `PushToggle` shown in the desktop bell-popover, but
 *   sized for a page-level card so mobile (PWA-installed) users can enable
 *   push from the menu → Notifications path.
 *
 *   Also opts the device into auto-subscribe-once on first launch when the
 *   page detects we're running as an installed PWA (display-mode: standalone)
 *   and push isn't already on/denied. See `useAutoEnablePush`.
 */
import { useState } from "react"
import { Smartphone } from "lucide-react"
import { Card, CardContent } from "@dashboard/ui/card"
import { Button } from "@dashboard/ui/button"
import { usePushSubscription } from "./usePushSubscription"
import { useAutoEnablePush } from "./useAutoEnablePush"
import { useGitHubIdentity } from "../hooks/useGitHubIdentity"

function defaultLabel(): string | undefined {
  if (typeof navigator === "undefined") return undefined
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return "iPhone Safari"
  if (/iPad/.test(ua)) return "iPad Safari"
  if (/Android/.test(ua)) return "Android Chrome"
  if (/Mac/.test(ua)) return "Mac Safari/Chrome"
  if (/Windows/.test(ua)) return "Windows Browser"
  return undefined
}

export function PushCard() {
  const { githubUser } = useGitHubIdentity()
  const push = usePushSubscription({
    userLogin: githubUser?.login,
    label: defaultLabel(),
  })

  // Auto-fire enable() once when running as installed PWA and not yet on.
  // No-ops on the desktop site / when already enabled / when denied.
  useAutoEnablePush(push)

  const { status, error, enable, disable, sendTest, busy } = push
  const [testMsg, setTestMsg] = useState<string | null>(null)

  const onTest = async () => {
    setTestMsg(null)
    try {
      const code = await sendTest()
      setTestMsg(`Push service accepted (${code}). Should arrive within seconds.`)
    } catch {
      // sendTest already wrote to `error`; nothing else to do here.
    }
  }

  const renderState = () => {
    switch (status) {
      case "loading":
        return <p className="text-sm text-white/50">Checking device…</p>
      case "unsupported":
        return (
          <p className="text-sm text-white/60">
            This browser doesn&apos;t support push notifications.
          </p>
        )
      case "needs-pwa":
        return (
          <>
            <p className="text-sm text-white/70">
              On iPhone, push only works after you install the dashboard:
            </p>
            <ol className="text-sm text-white/60 list-decimal pl-5 space-y-1">
              <li>Tap the Share icon in Safari</li>
              <li>Choose <strong>Add to Home Screen</strong></li>
              <li>Open Kody from the new icon and return here</li>
            </ol>
          </>
        )
      case "not-configured":
        return (
          <p className="text-sm text-amber-300/80">
            The server isn&apos;t configured for push yet — admin needs to set{" "}
            <code className="text-white/70">VAPID_PUBLIC_KEY</code> and{" "}
            <code className="text-white/70">VAPID_PRIVATE_KEY</code>.
          </p>
        )
      case "denied":
        return (
          <p className="text-sm text-rose-300/80">
            Notifications are blocked in your browser settings. Unblock
            them for this site, then come back and tap Enable.
          </p>
        )
      case "off":
        return (
          <div className="space-y-3">
            <p className="text-sm text-white/70">
              Get pinged on this device when a task fails, a PR is ready,
              or a release deploys.
            </p>
            <Button
              size="sm"
              onClick={() => void enable()}
              disabled={busy}
              className="gap-1"
            >
              {busy ? "Enabling…" : "Enable push on this device"}
            </Button>
          </div>
        )
      case "on":
        return (
          <div className="space-y-3">
            <p className="text-sm text-emerald-300/90">
              Push is enabled on this device.
            </p>
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                onClick={() => void onTest()}
                disabled={busy}
              >
                {busy ? "Sending…" : "Send test push"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void disable()}
                disabled={busy}
              >
                {busy ? "…" : "Disable on this device"}
              </Button>
            </div>
            {testMsg && (
              <p className="text-[12px] text-emerald-300/80">{testMsg}</p>
            )}
          </div>
        )
    }
  }

  return (
    <Card className="border-white/[0.08] bg-white/[0.02]">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold">
            Push notifications (this device)
          </h3>
        </div>
        {renderState()}
        {error && (
          <p className="text-[12px] text-rose-300/80">{error}</p>
        )}
      </CardContent>
    </Card>
  )
}
