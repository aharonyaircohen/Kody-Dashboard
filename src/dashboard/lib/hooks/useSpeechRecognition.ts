'use client'
/**
 * @fileType hook
 * @domain kody
 * @pattern browser-speech-api
 * @ai-summary React hook wrapping Web Speech Recognition API for speech-to-text
 */
import { useCallback, useEffect, useRef, useState } from 'react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionConstructor = new () => any

export interface UseSpeechRecognitionOptions {
  lang?: string
  onResult?: (transcript: string) => void
  onError?: (error: string) => void
  silenceDelayMs?: number // Auto-restart after silence detected
}
export interface UseSpeechRecognitionReturn {
  start: () => void
  stop: () => void
  isListening: boolean
  transcript: string
  finalTranscript: string
  error: string | null
  isSupported: boolean
}

function getCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions = {},
): UseSpeechRecognitionReturn {
  const { lang = 'en-US', onResult, onError, silenceDelayMs = 1500 } = options
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [finalTranscript, setFinalTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<any | null>(null)
  const onResultRef = useRef(onResult)
  const onErrorRef = useRef(onError)
  const silenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasSpeechRef = useRef(false)
  const continuousRestartRef = useRef(false)

  useEffect(() => {
    onResultRef.current = onResult
  }, [onResult])
  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  const isSupported = typeof window !== 'undefined' && getCtor() !== null

  const stop = useCallback(() => {
    // Clear any pending restart/silence timers
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current)
      silenceTimeoutRef.current = null
    }
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current)
      restartTimeoutRef.current = null
    }
    continuousRestartRef.current = false

    const r = recRef.current
    if (r) {
      r.onend = null
      r.onresult = null
      r.onerror = null
      try {
        r.stop()
      } catch {
        /* already stopped */
      }
      recRef.current = null
    }
    setIsListening(false)
  }, [])

  const start = useCallback(() => {
    const Ctor = getCtor()
    if (!Ctor) {
      const msg = 'Speech recognition is not supported in this browser'
      setError(msg)
      onErrorRef.current?.(msg)
      return
    }
    stop()
    setError(null)
    setTranscript('')
    hasSpeechRef.current = false
    continuousRestartRef.current = true

    const rec = new Ctor()
    rec.lang = lang
    rec.continuous = false
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onstart = () => {
      setIsListening(true)
      // Clear any pending restart when starting fresh
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current)
        restartTimeoutRef.current = null
      }
    }
    rec.onresult = (ev: any) => {
      let interim = '',
        final = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]
        if (r.isFinal) final += r[0].transcript
        else interim += r[0].transcript
      }

      // Clear silence timeout on any speech result
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current)
        silenceTimeoutRef.current = null
      }

      if (final) {
        hasSpeechRef.current = true
        setFinalTranscript(final)
        setTranscript(final)
        onResultRef.current?.(final)

        // Set silence timeout to auto-restart if user stops speaking
        silenceTimeoutRef.current = setTimeout(() => {
          if (continuousRestartRef.current && recRef.current) {
            // User paused - restart to allow continuous speech
            try {
              recRef.current.stop()
            } catch {
              /* already stopped */
            }
          }
        }, silenceDelayMs)
      } else if (interim) {
        setTranscript(interim)
        // Reset silence timeout while user is speaking
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current)
        }
        silenceTimeoutRef.current = setTimeout(() => {
          if (continuousRestartRef.current && recRef.current) {
            try {
              recRef.current.stop()
            } catch {
              /* already stopped */
            }
          }
        }, silenceDelayMs)
      }
    }
    rec.onerror = (ev: any) => {
      if (ev.error === 'no-speech' || ev.error === 'aborted') {
        // Auto-restart on no-speech if we've had speech (allows continuous listening)
        if (hasSpeechRef.current && continuousRestartRef.current) {
          hasSpeechRef.current = false
          setIsListening(false)
          // Brief delay then restart
          restartTimeoutRef.current = setTimeout(() => {
            if (continuousRestartRef.current) {
              start()
            }
          }, 300)
          return
        }
        setIsListening(false)
        return
      }
      const msg =
        ev.error === 'not-allowed'
          ? 'Microphone access was denied. Please allow microphone access in your browser settings.'
          : `Speech recognition error: ${ev.error}`
      setError(msg)
      setIsListening(false)
      continuousRestartRef.current = false
      onErrorRef.current?.(msg)
    }
    rec.onend = () => {
      setIsListening(false)
      recRef.current = null

      // Auto-restart if we had speech and continuous mode is enabled
      if (hasSpeechRef.current && continuousRestartRef.current) {
        hasSpeechRef.current = false
        // Brief delay to avoid rapid restarts
        restartTimeoutRef.current = setTimeout(() => {
          if (continuousRestartRef.current) {
            start()
          }
        }, 200)
      }
    }

    recRef.current = rec
    try {
      rec.start()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start speech recognition'
      setError(msg)
      setIsListening(false)
      continuousRestartRef.current = false
      onErrorRef.current?.(msg)
    }
  }, [lang, stop, silenceDelayMs])

  const wrappedStop = useCallback(() => {
    continuousRestartRef.current = false
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current)
      silenceTimeoutRef.current = null
    }
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current)
      restartTimeoutRef.current = null
    }
    stop()
  }, [stop])

  useEffect(
    () => () => {
      continuousRestartRef.current = false
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current)
      }
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current)
      }
      const r = recRef.current
      if (r) {
        r.onend = null
        r.onresult = null
        r.onerror = null
        try {
          r.stop()
        } catch {
          /* */
        }
        recRef.current = null
      }
    },
    [],
  )

  return { start, stop: wrappedStop, isListening, transcript, finalTranscript, error, isSupported }
}
