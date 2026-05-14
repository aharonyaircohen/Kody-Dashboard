/**
 * @fileType component
 * @domain brain
 * @pattern brain-fly-status-bar
 *
 * Small status row that appears above the chat input when the user has
 * "Kody Brain (Fly)" selected. Shows the current Fly app state (off /
 * running / suspended / stopped) by polling /api/kody/brain/status, and
 * offers a Destroy action that tears the app down. There's no manual
 * Provision/Wake button because the first chat message already does
 * both (provision if absent, resume from suspend if present).
 *
 * Polling cadence is intentionally slow (10s) — the state changes are
 * coarse (provision = ~60s, suspend = several minutes idle) so faster
 * polling just burns the Fly API budget for no UX gain.
 */
'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Brain, Loader2, RefreshCw, Power } from 'lucide-react'

import { Button } from '@dashboard/ui/button'
import { ConfirmDialog } from './ConfirmDialog'

export type BrainFlyState = 'off' | 'running' | 'suspended' | 'stopped' | 'unknown'

interface BrainFlyStatusBarProps {
  /** Authenticated request headers (x-kody-token / -owner / -repo). */
  headers: Record<string, string>
}

interface StatusResponse {
  state?: BrainFlyState
  app?: string
  url?: string
  machineId?: string
  error?: string
}

const POLL_INTERVAL_MS = 10_000

function pillClasses(state: BrainFlyState): string {
  switch (state) {
    case 'running':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
    case 'suspended':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30'
    case 'stopped':
      return 'bg-rose-500/15 text-rose-300 border-rose-500/30'
    case 'off':
      return 'bg-white/5 text-white/60 border-white/10'
    default:
      return 'bg-white/5 text-white/40 border-white/10'
  }
}

function pillLabel(state: BrainFlyState): string {
  switch (state) {
    case 'off':
      return 'Not provisioned'
    case 'running':
      return 'Running'
    case 'suspended':
      return 'Suspended (resumes on next message)'
    case 'stopped':
      return 'Stopped'
    default:
      return 'Status unknown'
  }
}

export function BrainFlyStatusBar({ headers }: BrainFlyStatusBarProps) {
  const [state, setState] = useState<BrainFlyState>('unknown')
  const [app, setApp] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [destroying, setDestroying] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const refresh = useCallback(async () => {
    if (Object.keys(headers).length === 0) {
      setState('unknown')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/kody/brain/status', { headers })
      if (!res.ok) {
        setState('unknown')
        return
      }
      const body = (await res.json()) as StatusResponse
      setState(body.state ?? 'unknown')
      setApp(body.app ?? null)
    } catch {
      setState('unknown')
    } finally {
      setLoading(false)
    }
  }, [headers])

  // Initial fetch + slow poll. Pauses naturally when the component unmounts
  // (i.e. user switches off the brain-fly agent). useEffect cleanup clears
  // the timer.
  useEffect(() => {
    let cancelled = false
    void refresh()
    const id = setInterval(() => {
      if (!cancelled) void refresh()
    }, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [refresh])

  async function destroy() {
    setDestroying(true)
    try {
      const res = await fetch('/api/kody/brain/destroy', {
        method: 'POST',
        headers,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(body.error ?? `Destroy failed (HTTP ${res.status})`)
        return
      }
      toast.success('Brain on Fly destroyed — next chat reprovisions')
      setState('off')
      setApp(null)
    } catch (err) {
      toast.error(`Destroy failed: ${(err as Error).message}`)
    } finally {
      setDestroying(false)
      setConfirmOpen(false)
    }
  }

  const canDestroy = state === 'running' || state === 'suspended' || state === 'stopped'

  return (
    <>
      <div className="flex items-center gap-3 px-3 py-2 mb-2 rounded-md border border-white/[0.08] bg-white/[0.03] text-xs">
        <Brain className="w-3.5 h-3.5 text-violet-400 shrink-0" />
        <span className="text-white/60 shrink-0">Brain on Fly</span>
        <span
          className={`px-2 py-0.5 rounded-full border text-[10px] font-medium uppercase tracking-wide ${pillClasses(
            state,
          )}`}
        >
          {pillLabel(state)}
        </span>
        {app && (
          <code className="text-[10px] text-white/30 font-mono truncate">{app}</code>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={refresh}
            disabled={loading}
            className="h-7 px-2 text-white/50 hover:text-white/80"
            title="Refresh status"
          >
            {loading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
          </Button>
          {canDestroy && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmOpen(true)}
              disabled={destroying}
              className="h-7 px-2 text-rose-300 hover:text-rose-200"
              title="Destroy the brain Fly app"
            >
              <Power className="w-3 h-3 mr-1" />
              {destroying ? 'Destroying…' : 'Destroy'}
            </Button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Destroy Brain on Fly?"
        description="Tears down the Fly app and any sessions stored on its filesystem. Your next chat message will reprovision from scratch (~60s)."
        confirmLabel={destroying ? 'Destroying…' : 'Destroy'}
        variant="destructive"
        onConfirm={destroy}
        onClose={() => setConfirmOpen(false)}
      />
    </>
  )
}
