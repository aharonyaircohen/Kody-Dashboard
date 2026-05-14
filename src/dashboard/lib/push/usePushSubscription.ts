"use client"
/**
 * @fileType hook
 * @domain kody
 * @pattern push-subscription-client
 * @ai-summary Browser-side push-subscription lifecycle. Wraps the
 *   `Notification`/`pushManager` API plus our server endpoints so the UI
 *   only needs a single `{ status, enable, disable }` shape.
 *
 *   Flow on `enable()`:
 *     1. Fetch VAPID public key from /api/push/public-key
 *     2. Wait for SW (registered by ServiceWorkerRegister) to be ready
 *     3. Request Notification permission
 *     4. pushManager.subscribe(...) → get { endpoint, keys }
 *     5. POST to /api/push/subscribe so the server stores it for fan-out
 *
 *   `disable()` reverses 4+5 (unsubscribe locally + DELETE server-side).
 */
import { useCallback, useEffect, useState } from "react"
import { urlBase64ToUint8Array } from "../push"
import { getStoredAuth } from "../api"

/**
 * Build the dashboard's standard repo-auth headers (`x-kody-token / -owner /
 * -repo`). The push API mirrors the rest of `/api/kody/*` and `/api/push/*`
 * — without these the server returns 401 "Missing repo auth headers". We
 * deliberately don't go through `buildHeaders` in api.ts because that
 * helper isn't exported; duplicating the three header names here is cheap.
 */
function authHeaders(): Record<string, string> {
  const auth = getStoredAuth()
  if (!auth) return { "Content-Type": "application/json" }
  return {
    "Content-Type": "application/json",
    "x-kody-token": auth.token,
    "x-kody-owner": auth.owner,
    "x-kody-repo": auth.repo,
  }
}

export type PushStatus =
  | "loading" // first render / determining state
  | "unsupported" // browser lacks ServiceWorker/Push/Notification
  | "needs-pwa" // iOS Safari requires home-screen install first
  | "not-configured" // server has no VAPID keys
  | "denied" // user blocked notifications
  | "off"
  | "on"

interface UsePushSubscriptionResult {
  status: PushStatus
  error: string | null
  enable: () => Promise<void>
  disable: () => Promise<void>
  busy: boolean
}

function browserSupportsPush(): boolean {
  if (typeof window === "undefined") return false
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

/**
 * iOS Safari only allows push from installed PWAs (standalone display mode).
 * If we're on iOS and not standalone, surface a clearer state so the UI can
 * tell the user to "Add to Home Screen" first.
 */
function isIosNotStandalone(): boolean {
  if (typeof window === "undefined") return false
  const ua = window.navigator.userAgent
  const isIos = /iPad|iPhone|iPod/.test(ua)
  if (!isIos) return false
  const standalone =
    // iOS Safari sets this proprietary property when launched from home
    (window.navigator as unknown as { standalone?: boolean }).standalone ===
      true ||
    window.matchMedia("(display-mode: standalone)").matches
  return !standalone
}

export function usePushSubscription(
  options: { userLogin?: string; label?: string } = {},
): UsePushSubscriptionResult {
  const [status, setStatus] = useState<PushStatus>("loading")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!browserSupportsPush()) {
      setStatus(isIosNotStandalone() ? "needs-pwa" : "unsupported")
      return
    }
    try {
      const perm = Notification.permission
      if (perm === "denied") {
        setStatus("denied")
        return
      }
      const reg = await navigator.serviceWorker.ready
      const existing = await reg.pushManager.getSubscription()
      setStatus(existing ? "on" : "off")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus("off")
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const enable = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      if (!browserSupportsPush()) {
        setStatus(isIosNotStandalone() ? "needs-pwa" : "unsupported")
        return
      }

      // 1) Public key
      const keyRes = await fetch("/api/push/public-key", { cache: "no-store" })
      if (keyRes.status === 503) {
        setStatus("not-configured")
        return
      }
      if (!keyRes.ok) {
        throw new Error(`public-key request failed: ${keyRes.status}`)
      }
      const { publicKey } = (await keyRes.json()) as { publicKey: string }

      // 2) SW ready
      const reg = await navigator.serviceWorker.ready

      // 3) Permission — pushManager.subscribe will also prompt, but asking
      //    first lets us short-circuit on denial without a half-baked sub.
      const perm = await Notification.requestPermission()
      if (perm !== "granted") {
        setStatus(perm === "denied" ? "denied" : "off")
        return
      }

      // 4) Subscribe (browser → push service → returns endpoint + keys).
      //    `applicationServerKey` expects a BufferSource — we hand it a
      //    fresh ArrayBuffer copy of the Uint8Array so TS doesn't complain
      //    about the SharedArrayBuffer-vs-ArrayBuffer narrowing.
      const keyBytes = urlBase64ToUint8Array(publicKey)
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes.buffer.slice(
          keyBytes.byteOffset,
          keyBytes.byteOffset + keyBytes.byteLength,
        ) as ArrayBuffer,
      })

      const json = sub.toJSON() as {
        endpoint?: string
        keys?: { p256dh?: string; auth?: string }
      }
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error("Browser returned an incomplete PushSubscription")
      }

      // 5) Register with the dashboard server (needs repo-auth headers)
      const subRes = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
          label: options.label,
          userLogin: options.userLogin,
        }),
      })
      if (!subRes.ok) {
        const text = await subRes.text().catch(() => "")
        // Roll back the browser subscription so a retry starts fresh —
        // otherwise the user is in a "subscribed locally, server doesn't
        // know" zombie state.
        await sub.unsubscribe().catch(() => {})
        throw new Error(
          `subscribe request failed: ${subRes.status} ${text.slice(0, 200)}`,
        )
      }

      setStatus("on")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [options.label, options.userLogin])

  const disable = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      if (!browserSupportsPush()) return
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (!sub) {
        setStatus("off")
        return
      }
      // Remove server-side first so a retry doesn't leave a stale row when
      // unsubscribe() on the browser fails.
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: authHeaders(),
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {})
      await sub.unsubscribe()
      setStatus("off")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [])

  return { status, error, enable, disable, busy }
}
