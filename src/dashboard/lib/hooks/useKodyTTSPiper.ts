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

// Turn a swallowed Piper failure into a short line the user can read on a
// phone (the console isn't visible there). Calls out the most common cause —
// the natural voice's threaded WASM needs SharedArrayBuffer, which only
// exists on a cross-origin-isolated page.
function describePiperError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/SharedArrayBuffer|cross-?origin|crossOriginIsolated|isolate/i.test(msg))
    return "Natural voice needs cross-origin isolation (SharedArrayBuffer unavailable).";
  if (/wasm|WebAssembly|compile|instantiate/i.test(msg))
    return `Natural-voice engine failed to load: ${msg.slice(0, 120)}`;
  return `Natural voice unavailable: ${msg.slice(0, 140)}`;
}

// A few samples of 8-bit silence as a WAV data URI. Played once from the
// mic-tap gesture to "unlock" the reusable <audio> element, so the real
// reply (which plays after an async gap) isn't blocked by the browser's
// autoplay policy. Built lazily in the browser (btoa is browser-only).
let _silentWav: string | null = null;
function silentWavDataUri(): string {
  if (_silentWav) return _silentWav;
  const numSamples = 8;
  const buffer = new ArrayBuffer(44 + numSamples);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + numSamples, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 8000, true); // sample rate
  view.setUint32(28, 8000, true); // byte rate (blockAlign 1 × rate)
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, numSamples, true);
  for (let i = 0; i < numSamples; i++) view.setUint8(44 + i, 128); // 8-bit silence
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  _silentWav = `data:audio/wav;base64,${btoa(bin)}`;
  return _silentWav;
}

// The onnxWasm version MUST match the `onnxruntime-web` JS that piper
// imports (resolved transitively via @mintplex-labs/piper-tts-web). A
// mismatch loads WASM with a different ABI than the JS expects and throws
// "r.getValue is not a function" at runtime → silent fallback to the basic
// browser voice. The library's own default points at cdnjs 1.18.0 (wrong +
// missing the `.mjs` loader), so we override here. Currently locked to
// onnxruntime-web@1.26.0 — bump this in lockstep whenever that dep changes
// (check `node_modules/.pnpm/onnxruntime-web@*`).
const WASM_PATHS = {
  onnxWasm: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/",
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
  const [failed, setFailed] = useState(false); // Piper bailed → browser voice
  const [engineError, setEngineError] = useState<string | null>(null);
  // One persistent <audio> element, reused for every reply. Reusing the
  // *same* element that we unlocked during the mic tap is what lets later
  // (async-fired) playback through — a fresh `new Audio()` per reply would
  // not inherit that unlock on iOS.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null); // current object URL, for cleanup
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
        if (!cancelled) {
          setFailed(true);
          setEngineError(describePiperError(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [voiceId]);

  // Lazily create the single reused <audio> element (browser only).
  const getAudioEl = useCallback((): HTMLAudioElement | null => {
    if (typeof window === "undefined") return null;
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  }, []);

  const revokeUrl = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      // Keep the element around (reused + still unlocked); just drop the src.
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
    revokeUrl();
    setIsSpeaking(false);
    browserTTS.cancel();
  }, [browserTTS, revokeUrl]);

  const unlock = useCallback(() => {
    // Prime the speechSynthesis fallback too (no-op if unsupported).
    browserTTS.unlock();
    const el = getAudioEl();
    if (!el) return;
    try {
      el.src = silentWavDataUri();
      const p = el.play();
      if (p && typeof p.then === "function") {
        p.then(() => {
          el.pause();
          el.currentTime = 0;
        }).catch(() => {
          // Best-effort: even a rejected play() often still unlocks the element.
        });
      }
    } catch {
      // Never let priming break starting the conversation.
    }
  }, [browserTTS, getAudioEl]);

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
          const audio = getAudioEl();
          if (!audio) {
            // No element (SSR / unsupported) — hand off to the fallback.
            fallbackRef.current = true;
            setIsSpeaking(false);
            browserTTS.speak(text);
            return;
          }
          const url = URL.createObjectURL(wav);
          revokeUrl();
          urlRef.current = url;
          audio.onended = () => {
            revokeUrl();
            setIsSpeaking(false);
            onEndRef.current?.();
          };
          audio.onerror = () => {
            revokeUrl();
            setIsSpeaking(false);
            onErrorRef.current?.();
            onEndRef.current?.();
          };
          audio.src = url;
          await audio.play();
        } catch (err) {
          console.warn("[useKodyTTSPiper] predict failed, falling back", err);
          fallbackRef.current = true;
          setFailed(true);
          setEngineError(describePiperError(err));
          setIsSpeaking(false);
          browserTTS.speak(text);
        }
      })();
    },
    [piperReady, cancel, browserTTS, getAudioEl, revokeUrl],
  );

  useEffect(
    () => () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    },
    [],
  );

  // Supported whenever either Piper or the browser TTS will work
  const isSupported = piperReady || browserTTS.isSupported;
  const speakingNow = isSpeaking || browserTTS.isSpeaking;
  const engine: "pending" | "piper" | "browser" = failed
    ? "browser"
    : piperReady
      ? "piper"
      : "pending";

  return {
    speak,
    cancel,
    unlock,
    isSpeaking: speakingNow,
    isSupported,
    engine,
    engineError,
  };
}
