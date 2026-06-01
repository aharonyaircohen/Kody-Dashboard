"use client";
/**
 * @fileType hook
 * @domain kody
 * @pattern state-machine
 * @ai-summary Orchestrates full voice conversation: LISTEN → PROCESS → SPEAK → LISTEN
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSpeechRecognition } from "./useSpeechRecognition";
import { useKodyTTSPiper } from "./useKodyTTSPiper";

export type VoiceChatState = "idle" | "listening" | "processing" | "speaking";
const STOP_WORDS =
  /^(stop|bye|goodbye|exit|quit|end|close|enough|תודה|ביי|עצור)$/i;

export interface UseVoiceChatOptions {
  onSendMessage: (text: string) => void;
  lang?: string;
  /** Piper voice id to speak English replies with (see voice/voices.ts). */
  voiceId?: string;
}
export interface UseVoiceChatReturn {
  state: VoiceChatState;
  startConversation: () => void;
  stopConversation: () => void;
  pauseConversation: () => void;
  resumeConversation: () => void;
  interruptConversation: () => void; // NEW: Allow interrupting AI to start listening
  currentTranscript: string;
  turnCount: number;
  error: string | null;
  isSupported: boolean;
  onResponseComplete: (text: string) => void;
  /** Streaming: speak one sentence as the reply arrives. */
  speakChunk: (sentence: string) => void;
  /** Streaming: signal the reply is complete (hand back to listening once drained). */
  endResponse: () => void;
  /** Which voice is actually playing: natural (Piper), basic (browser), or starting up. */
  ttsEngine: "pending" | "piper" | "browser";
  /** Reason the natural voice fell back, surfaced for on-device debugging. */
  ttsError: string | null;
}

export function useVoiceChat(options: UseVoiceChatOptions): UseVoiceChatReturn {
  const { onSendMessage, lang = "en-US", voiceId } = options;
  const [state, setState] = useState<VoiceChatState>("idle");
  const [turnCount, setTurnCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<VoiceChatState>("idle");
  const sendRef = useRef(onSendMessage);
  const retryRef = useRef(0);
  const pausedRef = useRef(false);
  const spokeThisTurnRef = useRef(false); // did this reply enqueue any speech?

  useEffect(() => {
    sendRef.current = onSendMessage;
  }, [onSendMessage]);
  const setS = useCallback((s: VoiceChatState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  const tts = useKodyTTSPiper({
    voiceId,
    onEnd: () => {
      if (stateRef.current === "speaking" && !pausedRef.current) {
        setS("listening");
        sttStartRef.current();
      } else if (stateRef.current === "speaking") setS("idle");
    },
    onError: () => {
      if (stateRef.current === "speaking" && !pausedRef.current) {
        setS("listening");
        sttStartRef.current();
      }
    },
  });

  const handleResult = useCallback(
    (transcript: string) => {
      if (stateRef.current !== "listening") return;
      const t = transcript.trim();
      if (!t) return;
      if (STOP_WORDS.test(t)) {
        setS("idle");
        sttStopRef.current();
        tts.cancel();
        return;
      }
      retryRef.current = 0;
      spokeThisTurnRef.current = false;
      setS("processing");
      // Mic off while the AI thinks + speaks — avoids it hearing the reply
      // and racing the restart. The TTS onEnd / endResponse handoff turns
      // it back on for the next turn.
      sttStopRef.current();
      sendRef.current(t);
    },
    [setS, tts],
  );

  const handleError = useCallback(
    (msg: string) => {
      if (stateRef.current !== "listening") return;
      if (retryRef.current < 1) {
        retryRef.current++;
        setTimeout(() => {
          if (stateRef.current === "listening") sttStartRef.current();
        }, 500);
        return;
      }
      setError(msg);
      setS("idle");
    },
    [setS],
  );

  const stt = useSpeechRecognition({
    lang,
    onResult: handleResult,
    onError: handleError,
  });
  const sttStartRef = useRef(stt.start);
  const sttStopRef = useRef(stt.stop);
  useEffect(() => {
    sttStartRef.current = stt.start;
  }, [stt.start]);
  useEffect(() => {
    sttStopRef.current = stt.stop;
  }, [stt.stop]);

  const isSupported = stt.isSupported && tts.isSupported;

  const startConversation = useCallback(() => {
    if (!isSupported) {
      setError("Voice chat is not supported in this browser");
      return;
    }
    // Runs inside the mic-tap gesture → unlock audio now so the first
    // (async) reply isn't silently blocked by the browser autoplay policy.
    tts.unlock();
    setError(null);
    setTurnCount(0);
    retryRef.current = 0;
    pausedRef.current = false;
    setS("listening");
    stt.start();
  }, [isSupported, setS, stt, tts]);

  const stopConversation = useCallback(() => {
    stt.stop();
    tts.cancel();
    pausedRef.current = false;
    retryRef.current = 0;
    setS("idle");
  }, [stt, tts, setS]);

  const pauseConversation = useCallback(() => {
    pausedRef.current = true;
    stt.stop();
    if (stateRef.current === "listening") setS("idle");
  }, [stt, setS]);

  const resumeConversation = useCallback(() => {
    if (!isSupported) return;
    tts.unlock(); // re-prime; resume is also a user gesture
    pausedRef.current = false;
    setError(null);
    setS("listening");
    stt.start();
  }, [isSupported, setS, stt, tts]);

  // NEW: Allow interrupting AI while it's speaking to start listening
  const interruptConversation = useCallback(() => {
    // Interrupt is a user gesture too — keep the audio unlock fresh.
    tts.unlock();
    // Cancel TTS if speaking
    tts.cancel();
    // Reset retry state
    retryRef.current = 0;
    pausedRef.current = false;
    // Go back to listening
    setS("listening");
    stt.start();
  }, [tts, setS, stt]);

  // Streaming: speak one sentence as the reply arrives. The first chunk of
  // a turn flips processing → speaking (and counts the turn); later chunks
  // just queue behind it so audio plays back-to-back.
  const speakChunk = useCallback(
    (sentence: string) => {
      if (pausedRef.current) return;
      const s = sentence.trim();
      if (!s) return;
      if (stateRef.current === "processing") {
        setTurnCount((p) => p + 1);
        setS("speaking");
      } else if (stateRef.current !== "speaking") {
        return; // not in a speakable state (idle/listening) — drop
      }
      spokeThisTurnRef.current = true;
      tts.enqueue(s);
    },
    [setS, tts],
  );

  // Streaming: the reply is complete. Tell TTS to hand back once drained.
  // If the model produced nothing speakable, resume listening directly.
  const endResponse = useCallback(() => {
    tts.finish();
    if (!spokeThisTurnRef.current && stateRef.current === "processing") {
      if (!pausedRef.current) {
        setS("listening");
        sttStartRef.current();
      } else {
        setS("idle");
      }
    }
  }, [setS, tts]);

  // Back-compat one-shot: speak a whole reply at once (non-streaming callers).
  const onResponseComplete = useCallback(
    (text: string) => {
      if (stateRef.current !== "processing") return;
      speakChunk(text);
      endResponse();
    },
    [speakChunk, endResponse],
  );

  useEffect(
    () => () => {
      stt.stop();
      tts.cancel();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup only on unmount
    [],
  );

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
    speakChunk,
    endResponse,
    ttsEngine: tts.engine ?? "pending",
    ttsError: tts.engineError ?? null,
  };
}
