"use client"
/**
 * @fileType hook
 * @domain kody
 * @pattern push-auto-enable
 * @ai-summary Auto-subscribes the device once when:
 *   1. The dashboard is running as an installed PWA (display-mode: standalone
 *      or iOS `navigator.standalone` is true) — so we don't pester desktop
 *      users browsing the site casually.
 *   2. Status is "off" (supported, permission not denied, no subscription).
 *   3. We haven't already tried on this device (one-shot per install,
 *      tracked via a localStorage flag — keyed so a re-install resets it).
 *
 *   The hook fires `enable()` once and remembers it. If the browser
 *   blocks the call (e.g. iOS demands a user gesture), the user can still
 *   tap "Enable" in the card. If they later `disable()` the flag stays
 *   set so we don't re-prompt on every launch.
 */
import { useEffect, useRef } from "react"
import type { PushStatus } from "./usePushSubscription"

const ATTEMPT_FLAG = "kody:push-auto-enabled"

interface PushApi {
  status: PushStatus
  enable: () => Promise<void>
}

function isInstalledPwa(): boolean {
  if (typeof window === "undefined") return false
  // iOS Safari's proprietary `standalone` predates display-mode and is
  // still the only reliable signal there.
  if (
    (window.navigator as unknown as { standalone?: boolean }).standalone ===
    true
  ) {
    return true
  }
  return window.matchMedia("(display-mode: standalone)").matches
}

export function useAutoEnablePush(push: PushApi): void {
  // useRef so the StrictMode double-effect doesn't fire enable() twice on
  // the same mount in dev. We still write to localStorage as the real
  // cross-mount guard.
  const attempted = useRef(false)

  useEffect(() => {
    if (attempted.current) return
    if (push.status !== "off") return
    if (!isInstalledPwa()) return

    try {
      if (window.localStorage.getItem(ATTEMPT_FLAG) === "1") return
    } catch {
      // localStorage can throw in private mode — fall through and try once.
    }

    attempted.current = true
    try {
      window.localStorage.setItem(ATTEMPT_FLAG, "1")
    } catch {
      // best-effort
    }

    // Fire and forget — `enable()` swallows errors into push.error.
    void push.enable()
  }, [push])
}
