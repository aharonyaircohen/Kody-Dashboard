"use client";
/**
 * @fileType hook
 * @domain kody
 * @pattern piper-wasm-tts-with-browser-fallback
 * @ai-summary Kody TTS using Piper (WASM) with auto-fallback to browser speechSynthesis
 *
 * Piper produces noticeably more human-sounding speech than the browser's
 * built-in `speechSynthesis`. Runs entirely in the browser via WASM/ONNX
 * (no server cost). On first use the voice model (~20MB) downloads into
 * Origin Private File System and is cached for subsequent calls.
 *
 * Fallback to `useKodyTTS` (browser speechSynthesis) is automatic when:
 *   - Language is not English (Piper voice list doesn't ship Hebrew)
 *   - WASM init fails (older mobile browsers / locked-down PWAs)
 *   - Model download / inference throws
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { stripMarkdown, detectLanguage } from "@dashboard/lib/speech-helpers";
import { useKodyTTS, type UseKodyTTSReturn } from "./useKodyTTS";

export interface UseKodyTTSPiperOptions {
  onEnd?: () => void;
  onError?: () => void;
  voiceId?: string; // Piper voice id; defaults to en_US-hfc_female-medium
}

const DEFAULT_VOICE = "en_US-hfc_female-medium";

// The library's default `ONNX_BASE` points at cdnjs's onnxruntime-web 1.18.0,
// which doesn't ship the `.mjs` loader Piper now needs (404). Pin to 1.19.2
// on jsDelivr — verified to host both the .mjs and the .wasm. The piper
// phonemizer WASM default is fine, but spelled out for clarity / future
// self-hosting.
const WASM_PATHS = {
  onnxWasm: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/",
  piperData:
    "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data",
  piperWasm:
    "https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm",
} as const;

export function useKodyTTSPiper(
  options: UseKodyTTSPiperOptions = {},
): UseKodyTTSReturn {
  const { onEnd, onError, voiceId = DEFAULT_VOICE } = options;
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [piperReady, setPiperReady] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef<unknown>(null); // lazy import of TtsSession
  const fallbackRef = useRef(false);
  const onEndRef = useRef(onEnd);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Browser TTS as fallback path
  const browserTTS = useKodyTTS({ onEnd, onError });

  // Lazy-init Piper session on mount (browser only)
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("@mintplex-labs/piper-tts-web");
        if (cancelled) return;
        const session = await mod.TtsSession.create({
          voiceId,
          wasmPaths: WASM_PATHS,
        });
        if (cancelled) return;
        sessionRef.current = session;
        setPiperReady(true);
      } catch (err) {
        // Init failed — keep using browser TTS fallback
        console.warn("[useKodyTTSPiper] init failed, falling back", err);
        fallbackRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [voiceId]);

  const cancel = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setIsSpeaking(false);
    browserTTS.cancel();
  }, [browserTTS]);

  const speak = useCallback(
    (text: string) => {
      const clean = stripMarkdown(text);
      if (!clean) {
        onEndRef.current?.();
        return;
      }
      // Hebrew (or anything non-English) → browser TTS, which already
      // picks the right system voice via `utt.lang`.
      const lang = detectLanguage(clean);
      if (lang !== "en" || fallbackRef.current || !piperReady) {
        browserTTS.speak(text);
        return;
      }
      cancel();
      setIsSpeaking(true);
      (async () => {
        try {
          const session = sessionRef.current as {
            predict: (t: string) => Promise<Blob>;
          };
          const wav = await session.predict(clean);
          const url = URL.createObjectURL(wav);
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onended = () => {
            URL.revokeObjectURL(url);
            audioRef.current = null;
            setIsSpeaking(false);
            onEndRef.current?.();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            audioRef.current = null;
            setIsSpeaking(false);
            onErrorRef.current?.();
            onEndRef.current?.();
          };
          await audio.play();
        } catch (err) {
          console.warn("[useKodyTTSPiper] predict failed, falling back", err);
          fallbackRef.current = true;
          setIsSpeaking(false);
          browserTTS.speak(text);
        }
      })();
    },
    [piperReady, cancel, browserTTS],
  );

  useEffect(
    () => () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    },
    [],
  );

  // Supported whenever either Piper or the browser TTS will work
  const isSupported = piperReady || browserTTS.isSupported;
  const speakingNow = isSpeaking || browserTTS.isSpeaking;

  return { speak, cancel, isSpeaking: speakingNow, isSupported };
}
