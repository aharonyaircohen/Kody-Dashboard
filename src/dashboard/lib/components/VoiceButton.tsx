'use client'
/**
 * @fileType component
 * @domain kody
 * @pattern voice-ui
 * @ai-summary Mic button for KodyChat input bar — tap for conversation, long-press for push-to-talk
 */
import { useCallback, useRef } from 'react'
import { Mic, MicOff } from 'lucide-react'
import { cn } from '@dashboard/lib/utils/ui'

const LONG_PRESS_MS = 500

interface VoiceButtonProps {
  isActive: boolean
  isSupported: boolean
  onTap: () => void
  onLongPressStart: () => void
  onLongPressEnd: () => void
  disabled?: boolean
}

export function VoiceButton({
  isActive,
  isSupported,
  onTap,
  onLongPressStart,
  onLongPressEnd,
  disabled = false,
}: VoiceButtonProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLongRef = useRef(false)

  const handlePointerDown = useCallback(() => {
    if (disabled) return
    isLongRef.current = false
    timerRef.current = setTimeout(() => {
      isLongRef.current = true
      onLongPressStart()
    }, LONG_PRESS_MS)
  }, [disabled, onLongPressStart])

  const handlePointerUp = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (isLongRef.current) {
      isLongRef.current = false
      onLongPressEnd()
    } else {
      onTap()
    }
  }, [onTap, onLongPressEnd])

  const handlePointerLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (isLongRef.current) {
      isLongRef.current = false
      onLongPressEnd()
    }
  }, [onLongPressEnd])

  if (!isSupported) return null
  const Icon = isActive ? MicOff : Mic
  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      disabled={disabled}
      className={cn(
        'p-2 rounded-md transition-colors select-none',
        isActive
          ? 'text-primary bg-primary/10 hover:bg-primary/20'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
      title={isActive ? 'Stop voice chat' : 'Voice chat (hold for push-to-talk)'}
      aria-label={isActive ? 'Stop voice chat' : 'Start voice chat'}
    >
      <Icon className="w-5 h-5" />
    </button>
  )
}
