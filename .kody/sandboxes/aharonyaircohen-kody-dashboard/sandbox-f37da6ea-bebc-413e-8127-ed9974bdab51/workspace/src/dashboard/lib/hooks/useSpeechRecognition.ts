"use client";
/**
 * @fileType hook
 * @domain kody
 * @pattern browser-speech-api
 * @ai-summary React hook wrapping Web Speech Recognition API for speech-to-text
 */
import { useCallback, useEffect, useRef, useState } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionConstructor = new () => any;

export interface UseSpeechRecognitionOptions {
  lang?: string;
  onResult?: (transcript: string) => void;
  onError?: (error: string) => void;
  silenceDelayMs?: number; // Auto-restart after silence detected
}
export interface UseSpeechRecognitionReturn {
  start: () => void;
  stop: () => void;
  isListening: boolean;
  transcript: string;
  finalTranscript: string;
  error: string | null;
  isSupported: boolean;
}

function getCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions = {},
): UseSpeechRecognitionReturn {
  const { lang = "en-US", onResult, onError, silenceDelayMs = 1500 } = options;
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<any | null>(null);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  const silenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSpeechRef = useRef(false);
  const continuousRestartRef = useRef(false);
  const startRetriedRef = useRef(false); // guard: retry a failed start once

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // isSupported must be stateful to avoid SSR/hydration mismatch.
  // SSR renders with window=undefined (isSupported=false → VoiceButton=null).
  // Initial client render also uses false so it matches SSR.
  // After hydration, useEffect sets the real value.
  const [isSupported, setIsSupported] = useState(false);
  useEffect(() => {
    setIsSupported(typeof window !== "undefined" && getCtor() !== null);
  }, []);

  const stop = useCallback(() => {
    // Clear any pending restart/silence timers
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    continuousRestartRef.current = false;

    const r = recRef.current;
    if (r) {
      r.onend = null;
      r.onresult = null;
      r.onerror = null;
      try {
        r.stop();
      } catch {
        /* already stopped */
      }
      recRef.current = null;
    }
    setIsListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) {
      const msg = "Speech recognition is not supported in this browser";
      setError(msg);
      onErrorRef.current?.(msg);
      return;
    }
    stop();
    setError(null);
    setTranscript("");
    hasSpeechRef.current = false;
    continuousRestartRef.current = true;

    // Restart recognition shortly. Used to (a) keep the mic alive through
    // silence and (b) recover from the start()/teardown race. Replaces any
    // pending restart so timers never stack.
    const scheduleRestart = (delay: number) => {
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = setTimeout(() => {
        restartTimeoutRef.current = null;
        if (continuousRestartRef.current) start();
      }, delay);
    };

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      setIsListening(true);
      startRetriedRef.current = false; // a clean start clears the retry guard
      // Clear any pending restart when starting fresh
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
        restartTimeoutRef.current = null;
      }
    };
    rec.onresult = (ev: any) => {
      let interim = "",
        final = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }

      // Clear silence timeout on any speech result
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = null;
      }

      if (final) {
        hasSpeechRef.current = true;
        setFinalTranscript(final);
        setTranscript(final);
        onResultRef.current?.(final);

        // Set silence timeout to auto-restart if user stops speaking
        silenceTimeoutRef.current = setTimeout(() => {
          if (continuousRestartRef.current && recRef.current) {
            // User paused - restart to allow continuous speech
            try {
              recRef.current.stop();
            } catch {
              /* already stopped */
            }
          }
        }, silenceDelayMs);
      } else if (interim) {
        setTranscript(interim);
        // Reset silence timeout while user is speaking
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
        }
        silenceTimeoutRef.current = setTimeout(() => {
          if (continuousRestartRef.current && recRef.current) {
            try {
              recRef.current.stop();
            } catch {
              /* already stopped */
            }
          }
        }, silenceDelayMs);
      }
    };
    rec.onerror = (ev: any) => {
      if (ev.error === "no-speech" || ev.error === "aborted") {
        setIsListening(false);
        // Keep the mic alive through silence. Chrome's no-speech timeout
        // (and the abort from our own silence-driven stop) would otherwise
        // kill recognition for good — so a pause before speaking, or right
        // after, leaves the next words unrecorded. Restart whenever we're
        // still meant to be listening, regardless of prior speech.
        if (continuousRestartRef.current) {
          hasSpeechRef.current = false;
          scheduleRestart(300);
        }
        return;
      }
      const msg =
        ev.error === "not-allowed"
          ? "Microphone access was denied. Please allow microphone access in your browser settings."
          : `Speech recognition error: ${ev.error}`;
      setError(msg);
      setIsListening(false);
      continuousRestartRef.current = false;
      onErrorRef.current?.(msg);
    };
    rec.onend = () => {
      setIsListening(false);
      recRef.current = null;

      // Keep the mic alive while we're meant to be listening. Skip if a
      // restart is already queued (e.g. from onerror) so we don't double-fire.
      if (continuousRestartRef.current && !restartTimeoutRef.current) {
        hasSpeechRef.current = false;
        scheduleRestart(200);
      }
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch (err) {
      // Chrome throws if the previous recognition hasn't released the mic
      // yet (rapid stop→start). Retry once before surfacing a hard error —
      // otherwise the mic is stranded "off" while the UI still says listening.
      if (continuousRestartRef.current && !startRetriedRef.current) {
        startRetriedRef.current = true;
        recRef.current = null;
        scheduleRestart(300);
        return;
      }
      startRetriedRef.current = false;
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to start speech recognition";
      setError(msg);
      setIsListening(false);
      continuousRestartRef.current = false;
      onErrorRef.current?.(msg);
    }
  }, [lang, stop, silenceDelayMs]);

  const wrappedStop = useCallback(() => {
    continuousRestartRef.current = false;
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    stop();
  }, [stop]);

  useEffect(
    () => () => {
      continuousRestartRef.current = false;
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
      }
      const r = recRef.current;
      if (r) {
        r.onend = null;
        r.onresult = null;
        r.onerror = null;
        try {
          r.stop();
        } catch {
          /* */
        }
        recRef.current = null;
      }
    },
    [],
  );

  return {
    start,
    stop: wrappedStop,
    isListening,
    transcript,
    finalTranscript,
    error,
    isSupported,
  };
}
