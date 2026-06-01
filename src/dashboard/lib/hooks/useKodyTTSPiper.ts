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
 * Streaming queue: instead of waiting for a whole reply, the voice loop
 * `enqueue()`s sentences as the model streams them and calls `finish()`
 * when the reply ends. A single worker synthesizes + plays segments
 * back-to-back through one reused (unlocked) <audio> element, and fires
 * `onEnd` only once the queue has drained AND the stream is finished — so
 * the conversation hands back to listening at the right moment. `speak()`
 * is kept as a single-shot convenience (enqueue + finish).
 *
 * Fallback to browser speechSynthesis is automatic when:
 *   - Language is not English (Piper voice list doesn't ship Hebrew)
 *   - WASM init fails (older mobile browsers / locked-down PWAs)
 *   - Model download / inference throws
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { stripMarkdown, detectLanguage } from "@dashboard/lib/speech-helpers";
import { DEFAULT_VOICE_ID } from "@dashboard/lib/voice/voices";
import { useKodyTTS, type UseKodyTTSReturn } from "./useKodyTTS";

export interface UseKodyTTSPiperReturn extends UseKodyTTSReturn {
  /** Queue one sentence/segment for speaking; starts playback if idle. */
  enqueue: (text: string) => void;
  /** Signal the streamed reply is complete; `onEnd` fires once drained. */
  finish: () => void;
}

export interface UseKodyTTSPiperOptions {
  onEnd?: () => void;
  onError?: () => void;
  voiceId?: string; // Piper voice id; defaults to en_US-hfc_female-medium
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
): UseKodyTTSPiperReturn {
  const { onEnd, onError, voiceId = DEFAULT_VOICE_ID } = options;
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [piperReady, setPiperReady] = useState(false);
  const [failed, setFailed] = useState(false); // Piper bailed → browser voice
  const [engineError, setEngineError] = useState<string | null>(null);

  // One persistent <audio> element, reused for every segment. Reusing the
  // *same* element that we unlocked during the mic tap is what lets later
  // (async-fired) playback through — a fresh `new Audio()` per reply would
  // not inherit that unlock on iOS.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null); // current object URL, for cleanup
  const sessionRef = useRef<unknown>(null); // lazy import of TtsSession
  const fallbackRef = useRef(false);
  const piperReadyRef = useRef(false);
  const onEndRef = useRef(onEnd);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  useEffect(() => {
    piperReadyRef.current = piperReady;
  }, [piperReady]);

  // Streaming queue state.
  const queueRef = useRef<string[]>([]);
  const doneRef = useRef(false); // stream finished → drain then fire onEnd
  const runningRef = useRef(false); // worker active
  const genRef = useRef(0); // bumped on cancel to abandon a stale worker

  // Browser TTS as fallback path.
  const browserTTS = useKodyTTS({ onEnd, onError });
  const {
    speakAsync: browserSpeakAsync,
    cancel: browserCancel,
    unlock: browserUnlock,
    isSupported: browserSupported,
    isSpeaking: browserSpeaking,
  } = browserTTS;

  // Lazy-init Piper session on mount, and re-init whenever the voice
  // changes. Reset readiness/failure first so a voice switch is a clean
  // retry (English speech falls back to the browser voice only during the
  // ~model-load gap, then the new Piper voice takes over).
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    setPiperReady(false);
    setFailed(false);
    setEngineError(null);
    fallbackRef.current = false;
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

  // Speak one segment, resolving when it finishes (or errors). Picks the
  // natural Piper voice for English when ready, else the browser fallback.
  const speakOne = useCallback(
    async (text: string): Promise<void> => {
      const clean = stripMarkdown(text);
      if (!clean) return;
      const lang = detectLanguage(clean);
      if (lang !== "en" || fallbackRef.current || !piperReadyRef.current) {
        await browserSpeakAsync(text);
        return;
      }
      try {
        const session = sessionRef.current as {
          predict: (t: string) => Promise<Blob>;
        };
        const wav = await session.predict(clean);
        const audio = getAudioEl();
        if (!audio) {
          await browserSpeakAsync(text);
          return;
        }
        const url = URL.createObjectURL(wav);
        revokeUrl();
        urlRef.current = url;
        await new Promise<void>((resolve) => {
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            revokeUrl();
            resolve();
          };
          audio.onended = done;
          audio.onerror = done;
          audio.src = url;
          audio.play().catch(() => done());
        });
      } catch (err) {
        console.warn("[useKodyTTSPiper] predict failed, falling back", err);
        fallbackRef.current = true;
        setFailed(true);
        setEngineError(describePiperError(err));
        await browserSpeakAsync(text);
      }
    },
    [browserSpeakAsync, getAudioEl, revokeUrl],
  );

  // Drain the queue one segment at a time. A new worker is only started when
  // one isn't already running (enqueue kicks it). Bails if `cancel` bumped
  // the generation mid-flight. Fires `onEnd` once empty AND the stream ended.
  const runWorker = useCallback(async () => {
    if (runningRef.current) return;
    const myGen = genRef.current;
    runningRef.current = true;
    setIsSpeaking(true);
    while (queueRef.current.length > 0 && genRef.current === myGen) {
      const next = queueRef.current.shift();
      if (next === undefined) break;
      await speakOne(next);
    }
    if (genRef.current !== myGen) return; // cancelled — cancel() reset state
    runningRef.current = false;
    setIsSpeaking(false);
    if (doneRef.current && queueRef.current.length === 0) {
      onEndRef.current?.();
    }
  }, [speakOne]);

  const enqueue = useCallback(
    (text: string) => {
      if (!stripMarkdown(text)) return;
      queueRef.current.push(text);
      if (!runningRef.current) void runWorker();
    },
    [runWorker],
  );

  const finish = useCallback(() => {
    doneRef.current = true;
    // Nothing queued and nothing playing → drain already happened; hand back.
    if (!runningRef.current && queueRef.current.length === 0) {
      onEndRef.current?.();
    }
  }, []);

  const cancel = useCallback(() => {
    genRef.current++; // abandon any in-flight worker
    queueRef.current = [];
    doneRef.current = false;
    runningRef.current = false;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
    revokeUrl();
    browserCancel();
    if (typeof window !== "undefined" && window.speechSynthesis)
      window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, [browserCancel, revokeUrl]);

  // Single-shot convenience: speak one blob of text start to finish.
  const speak = useCallback(
    (text: string) => {
      cancel();
      genRef.current++; // fresh generation after the cancel above
      enqueue(text);
      finish();
    },
    [cancel, enqueue, finish],
  );

  const unlock = useCallback(() => {
    // Prime the speechSynthesis fallback too (no-op if unsupported).
    browserUnlock();
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
  }, [browserUnlock, getAudioEl]);

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
  const isSupported = piperReady || browserSupported;
  const speakingNow = isSpeaking || browserSpeaking;
  const engine: "pending" | "piper" | "browser" = failed
    ? "browser"
    : piperReady
      ? "piper"
      : "pending";

  return {
    speak,
    speakAsync: speakOne,
    enqueue,
    finish,
    cancel,
    unlock,
    isSpeaking: speakingNow,
    isSupported,
    engine,
    engineError,
  };
}
