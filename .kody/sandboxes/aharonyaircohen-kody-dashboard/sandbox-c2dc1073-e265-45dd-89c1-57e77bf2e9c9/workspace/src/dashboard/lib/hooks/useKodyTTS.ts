"use client";
/**
 * @fileType hook
 * @domain kody
 * @pattern browser-speech-api
 * @ai-summary Kody-specific TTS hook with onEnd callback for conversation loop
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { stripMarkdown, detectLanguage } from "@dashboard/lib/speech-helpers";

export interface UseKodyTTSOptions {
  onEnd?: () => void;
  onError?: () => void;
}
export interface UseKodyTTSReturn {
  speak: (text: string) => void;
  /**
   * Like `speak`, but returns a promise that resolves when this one
   * utterance finishes (or errors). Used by the streaming TTS queue to
   * play fallback segments back-to-back without relying on the hook-level
   * `onEnd` callback (which the queue owns).
   */
  speakAsync: (text: string) => Promise<void>;
  cancel: () => void;
  /**
   * Prime the audio output inside a user gesture (the mic tap). Browsers
   * only let a page make sound that's tied to a tap; voice replies play a
   * moment later (after the AI answers), so without this priming call they
   * are silently blocked — especially in a freshly-installed PWA. Call this
   * synchronously from the tap handler.
   */
  unlock: () => void;
  isSpeaking: boolean;
  isSupported: boolean;
  /**
   * Which engine is actually producing speech: the natural Piper voice,
   * the basic browser voice, or still initializing. Used by the voice UI
   * to tell the user (and us) when the natural voice silently fell back.
   */
  engine?: "pending" | "piper" | "browser";
  /** Human-readable reason Piper bailed to the browser voice, if any. */
  engineError?: string | null;
}

export function useKodyTTS(options: UseKodyTTSOptions = {}): UseKodyTTSReturn {
  const { onEnd, onError } = options;
  const [isSpeaking, setIsSpeaking] = useState(false);
  const uttRef = useRef<SpeechSynthesisUtterance | null>(null);
  const onEndRef = useRef(onEnd);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // isSupported must be stateful to avoid SSR/hydration mismatch (same fix as useSpeechRecognition)
  const [isSupported, setIsSupported] = useState(false);
  useEffect(() => {
    setIsSupported(
      typeof window !== "undefined" && "speechSynthesis" in window,
    );
  }, []);

  const cancel = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis)
      window.speechSynthesis.cancel();
    uttRef.current = null;
    setIsSpeaking(false);
  }, []);

  const unlock = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      // Speaking a near-empty, silent utterance from inside the tap grants
      // speechSynthesis the user-activation it needs for later, async-fired
      // replies (iOS Safari requires this; Chrome treats it as engagement).
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch {
      // Best-effort priming — never let it break starting the conversation.
    }
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !window.speechSynthesis) {
        onEndRef.current?.();
        return;
      }
      cancel();
      const clean = stripMarkdown(text);
      if (!clean) {
        onEndRef.current?.();
        return;
      }
      const utt = new SpeechSynthesisUtterance(clean);
      utt.lang = detectLanguage(clean);
      utt.onend = () => {
        setIsSpeaking(false);
        uttRef.current = null;
        onEndRef.current?.();
      };
      utt.onerror = () => {
        setIsSpeaking(false);
        uttRef.current = null;
        onErrorRef.current?.();
        onEndRef.current?.();
      };
      uttRef.current = utt;
      setIsSpeaking(true);
      window.speechSynthesis.speak(utt);
    },
    [cancel],
  );

  const speakAsync = useCallback(
    (text: string): Promise<void> =>
      new Promise((resolve) => {
        if (typeof window === "undefined" || !window.speechSynthesis) {
          resolve();
          return;
        }
        const clean = stripMarkdown(text);
        if (!clean) {
          resolve();
          return;
        }
        const utt = new SpeechSynthesisUtterance(clean);
        utt.lang = detectLanguage(clean);
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (uttRef.current === utt) uttRef.current = null;
          setIsSpeaking(false);
          resolve();
        };
        utt.onend = finish;
        utt.onerror = finish;
        uttRef.current = utt;
        setIsSpeaking(true);
        window.speechSynthesis.speak(utt);
      }),
    [],
  );

  useEffect(
    () => () => {
      if (typeof window !== "undefined" && window.speechSynthesis)
        window.speechSynthesis.cancel();
    },
    [],
  );

  return {
    speak,
    speakAsync,
    cancel,
    unlock,
    isSpeaking,
    isSupported,
    engine: "browser",
    engineError: null,
  };
}
