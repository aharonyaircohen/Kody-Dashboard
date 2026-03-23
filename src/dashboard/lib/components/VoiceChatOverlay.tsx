'use client'
/**
 * @fileType component
 * @domain kody
 * @pattern voice-ui
 * @ai-summary Voice conversation overlay scoped to the chat panel (not full-screen)
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, PhoneOff, Loader2, Volume2 } from 'lucide-react'
import { cn } from '@dashboard/lib/utils/ui'
import type { VoiceChatState } from '../hooks/useVoiceChat'

interface VoiceChatOverlayProps {
  state: VoiceChatState
  currentTranscript: string
  turnCount: number
  error: string | null
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  agentName: string
  onStop: () => void
  onInterrupt?: () => void // New: interrupt AI and start listening
  onToggleMute: () => void
  isMuted: boolean
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function VoiceChatOverlay({
  state,
  currentTranscript,
  turnCount,
  error,
  messages,
  agentName,
  onStop,
  onInterrupt,
  onToggleMute,
  isMuted,
}: VoiceChatOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Handle tap to interrupt when AI is speaking
  const handleStateIndicatorClick = useCallback(() => {
    if (state === 'speaking' && onInterrupt) {
      onInterrupt()
    }
  }, [state, onInterrupt])

  useEffect(() => {
    setElapsed(0)
    timerRef.current = setInterval(() => setElapsed((p) => p + 1), 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onStop()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onStop])

  const handleTabTrap = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !overlayRef.current) return
    const els = overlayRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    if (els.length === 0) return
    if (e.shiftKey && document.activeElement === els[0]) {
      e.preventDefault()
      els[els.length - 1].focus()
    } else if (!e.shiftKey && document.activeElement === els[els.length - 1]) {
      e.preventDefault()
      els[0].focus()
    }
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', handleTabTrap)
    return () => window.removeEventListener('keydown', handleTabTrap)
  }, [handleTabTrap])

  useEffect(() => {
    overlayRef.current?.focus()
  }, [])

  const recent = messages.slice(-4)

  // Handle tap to interrupt when AI is speaking - using onInterrupt prop
  const handleOverlayClick = useCallback(() => {
    if (state === 'speaking' && onInterrupt) {
      onInterrupt()
    }
  }, [state, onInterrupt])

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Voice chat conversation"
      tabIndex={-1}
      className={cn(
        'absolute inset-0 z-40 flex flex-col bg-background/95 backdrop-blur-sm overflow-hidden',
        state === 'speaking' && 'cursor-pointer', // Show it's clickable when AI is speaking
      )}
      onClick={handleOverlayClick}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b text-center shrink-0">
        <h2 className="text-sm font-semibold">🎤 Voice Chat</h2>
        <p className="text-xs text-muted-foreground">with {agentName}</p>
      </div>

      {/* Recent conversation — scrollable middle section */}
      <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0">
        {recent.map((msg, i) => (
          <div
            key={i}
            className={cn(
              'mb-2 px-2.5 py-1.5 rounded-lg text-xs max-w-[90%]',
              msg.role === 'user'
                ? 'ml-auto bg-primary text-primary-foreground'
                : 'mr-auto bg-muted',
            )}
          >
            <span className="font-medium text-[10px] opacity-70 block mb-0.5">
              {msg.role === 'user' ? 'You' : 'Kody'}
            </span>
            <span className="line-clamp-2">{msg.content}</span>
          </div>
        ))}
      </div>

      {/* State indicator - clickable when AI is speaking to interrupt */}
      <div
        className={cn(
          'flex flex-col items-center gap-2 py-4 shrink-0',
          state === 'speaking' && 'cursor-pointer',
        )}
        onClick={handleStateIndicatorClick}
      >
        <div
          className={cn(
            'relative flex items-center justify-center w-16 h-16 rounded-full transition-all duration-300',
            state === 'listening' && 'bg-primary/10',
            state === 'processing' && 'bg-amber-500/10',
            state === 'speaking' && 'bg-green-500/10 hover:bg-green-500/20',
          )}
        >
          {state === 'listening' && !isMuted && (
            <>
              <span className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
              <span
                className="absolute inset-1 rounded-full bg-primary/15 animate-ping"
                style={{ animationDelay: '0.3s' }}
              />
            </>
          )}
          {state === 'listening' && (
            <Mic
              className={cn(
                'w-7 h-7 relative z-10 transition-colors',
                isMuted ? 'text-muted-foreground' : 'text-primary',
              )}
            />
          )}
          {state === 'processing' && (
            <Loader2 className="w-7 h-7 text-amber-500 animate-spin relative z-10" />
          )}
          {state === 'speaking' && (
            <Volume2 className="w-7 h-7 text-green-500 animate-pulse relative z-10" />
          )}
        </div>

        <div aria-live="polite" className="text-center">
          {state === 'listening' && !isMuted && (
            <p className="text-sm font-medium text-primary">Listening...</p>
          )}
          {state === 'listening' && isMuted && (
            <p className="text-sm font-medium text-muted-foreground">Muted</p>
          )}
          {state === 'processing' && (
            <p className="text-sm font-medium text-amber-500">Thinking...</p>
          )}
          {state === 'speaking' && (
            <p className="text-sm font-medium text-green-500">Speaking...</p>
          )}
          {/* Hint to interrupt when AI is speaking */}
          {state === 'speaking' && (
            <p className="text-xs text-muted-foreground animate-pulse">Tap anywhere to interrupt</p>
          )}
        </div>

        {state === 'listening' && currentTranscript && (
          <div className="mx-4 px-3 py-1.5 bg-muted rounded-lg text-center">
            <p className="text-xs italic text-muted-foreground">
              &ldquo;{currentTranscript}&rdquo;
            </p>
          </div>
        )}

        {error && (
          <div className="mx-4 px-3 py-1.5 bg-destructive/10 border border-destructive/20 rounded-lg text-center">
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-4 pb-3 shrink-0">
        <button
          type="button"
          onClick={onToggleMute}
          className={cn(
            'flex items-center justify-center w-10 h-10 rounded-full transition-colors',
            isMuted
              ? 'bg-amber-500/20 text-amber-500 hover:bg-amber-500/30'
              : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground',
          )}
          aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>

        <button
          type="button"
          onClick={onStop}
          className="flex items-center justify-center w-12 h-12 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
          aria-label="End voice chat"
        >
          <PhoneOff className="w-5 h-5" />
        </button>
      </div>

      {/* Footer */}
      <div className="px-3 pb-2 text-center shrink-0">
        <p className="text-[10px] text-muted-foreground">
          Turn {turnCount} · {formatElapsed(elapsed)} ·{' '}
          <kbd className="px-0.5 py-px bg-muted rounded text-[9px]">Esc</kbd> to end
        </p>
      </div>
    </div>
  )
}
