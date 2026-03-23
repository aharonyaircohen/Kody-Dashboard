'use client'
/**
 * @fileType hook
 * @domain kody
 * @pattern state-machine
 * @ai-summary Orchestrates full voice conversation: LISTEN → PROCESS → SPEAK → LISTEN
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSpeechRecognition } from './useSpeechRecognition'
import { useKodyTTS } from './useKodyTTS'

export type VoiceChatState = 'idle' | 'listening' | 'processing' | 'speaking'
const STOP_WORDS = /^(stop|bye|goodbye|exit|quit|end|close|enough|תודה|ביי|עצור)$/i

export interface UseVoiceChatOptions {
  onSendMessage: (text: string) => void
  lang?: string
}
export interface UseVoiceChatReturn {
  state: VoiceChatState
  startConversation: () => void
  stopConversation: () => void
  pauseConversation: () => void
  resumeConversation: () => void
  interruptConversation: () => void // NEW: Allow interrupting AI to start listening
  currentTranscript: string
  turnCount: number
  error: string | null
  isSupported: boolean
  onResponseComplete: (text: string) => void
}

export function useVoiceChat(options: UseVoiceChatOptions): UseVoiceChatReturn {
  const { onSendMessage, lang = 'en-US' } = options
  const [state, setState] = useState<VoiceChatState>('idle')
  const [turnCount, setTurnCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const stateRef = useRef<VoiceChatState>('idle')
  const sendRef = useRef(onSendMessage)
  const retryRef = useRef(0)
  const pausedRef = useRef(false)

  useEffect(() => {
    sendRef.current = onSendMessage
  }, [onSendMessage])
  const setS = useCallback((s: VoiceChatState) => {
    stateRef.current = s
    setState(s)
  }, [])

  const tts = useKodyTTS({
    onEnd: () => {
      if (stateRef.current === 'speaking' && !pausedRef.current) {
        setS('listening')
        sttStartRef.current()
      } else if (stateRef.current === 'speaking') setS('idle')
    },
    onError: () => {
      if (stateRef.current === 'speaking' && !pausedRef.current) {
        setS('listening')
        sttStartRef.current()
      }
    },
  })

  const handleResult = useCallback(
    (transcript: string) => {
      if (stateRef.current !== 'listening') return
      const t = transcript.trim()
      if (!t) return
      if (STOP_WORDS.test(t)) {
        setS('idle')
        sttStopRef.current()
        tts.cancel()
        return
      }
      retryRef.current = 0
      setS('processing')
      sendRef.current(t)
    },
    [setS, tts],
  )

  const handleError = useCallback(
    (msg: string) => {
      if (stateRef.current !== 'listening') return
      if (retryRef.current < 1) {
        retryRef.current++
        setTimeout(() => {
          if (stateRef.current === 'listening') sttStartRef.current()
        }, 500)
        return
      }
      setError(msg)
      setS('idle')
    },
    [setS],
  )

  const stt = useSpeechRecognition({ lang, onResult: handleResult, onError: handleError })
  const sttStartRef = useRef(stt.start)
  const sttStopRef = useRef(stt.stop)
  useEffect(() => {
    sttStartRef.current = stt.start
  }, [stt.start])
  useEffect(() => {
    sttStopRef.current = stt.stop
  }, [stt.stop])

  const isSupported = stt.isSupported && tts.isSupported

  const startConversation = useCallback(() => {
    if (!isSupported) {
      setError('Voice chat is not supported in this browser')
      return
    }
    setError(null)
    setTurnCount(0)
    retryRef.current = 0
    pausedRef.current = false
    setS('listening')
    stt.start()
  }, [isSupported, setS, stt])

  const stopConversation = useCallback(() => {
    stt.stop()
    tts.cancel()
    pausedRef.current = false
    retryRef.current = 0
    setS('idle')
  }, [stt, tts, setS])

  const pauseConversation = useCallback(() => {
    pausedRef.current = true
    stt.stop()
    if (stateRef.current === 'listening') setS('idle')
  }, [stt, setS])

  const resumeConversation = useCallback(() => {
    if (!isSupported) return
    pausedRef.current = false
    setError(null)
    setS('listening')
    stt.start()
  }, [isSupported, setS, stt])

  // NEW: Allow interrupting AI while it's speaking to start listening
  const interruptConversation = useCallback(() => {
    // Cancel TTS if speaking
    tts.cancel()
    // Reset retry state
    retryRef.current = 0
    pausedRef.current = false
    // Go back to listening
    setS('listening')
    stt.start()
  }, [tts, setS, stt])

  const onResponseComplete = useCallback(
    (text: string) => {
      if (stateRef.current !== 'processing') return
      setTurnCount((p) => p + 1)
      setS('speaking')
      tts.speak(text)
    },
    [setS, tts],
  )

  useEffect(
    () => () => {
      stt.stop()
      tts.cancel()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup only on unmount
    [],
  )

  return {
    state,
    startConversation,
    stopConversation,
    pauseConversation,
    resumeConversation,
    interruptConversation,
    currentTranscript: stt.transcript,
    turnCount,
    error,
    isSupported,
    onResponseComplete,
  }
}
