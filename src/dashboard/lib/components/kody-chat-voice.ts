/**
 * @fileType hook
 * @domain kody
 * @pattern kody-chat-voice
 * @ai-summary Voice-mode orchestration extracted from KodyChat (phase
 *   1.6c): overlay/mute state, the per-user Piper voice preference, the
 *   voice→sendText→TTS glue (sentence-streamed speakChunk), the mute
 *   toggle, and the overlay-close cleanup. The speech/TTS internals stay
 *   in hooks/useVoiceChat — this module only moves KodyChat's wiring
 *   around it. Behavior is identical to the pre-extraction inline code.
 *
 *   Placement note: lives in components/ next to the other phase-1.6
 *   extractions (kody-chat-live-runner.ts / kody-chat-send.ts) — it is
 *   KodyChat wiring, not reusable chat/core logic.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceChat, type UseVoiceChatReturn } from "../hooks/useVoiceChat";
import { extractSentences } from "@dashboard/lib/speech-helpers";
import {
  DEFAULT_VOICE_ID,
  loadVoicePreference,
  saveVoicePreference,
} from "@dashboard/lib/voice/voices";
import type { SendTextFn } from "./kody-chat-send";

export interface UseVoiceOrchestrationOptions {
  /**
   * Deferred handle to the send pipeline. Read at speak time (not mount
   * time) so the voice turn always uses the freshest sendText closure —
   * KodyChat binds the ref right after declaring sendText each render.
   */
  sendTextRef: React.MutableRefObject<SendTextFn | null>;
}

export interface UseVoiceOrchestrationResult {
  voiceChat: UseVoiceChatReturn;
  voiceMuted: boolean;
  setVoiceMuted: (muted: boolean) => void;
  voiceOverlayOpen: boolean;
  setVoiceOverlayOpen: (open: boolean) => void;
  /** Per-user Piper voice choice (persisted in localStorage). */
  voiceId: string;
  handleSelectVoice: (id: string) => void;
  handleVoiceToggleMute: () => void;
}

/**
 * KodyChat's voice-mode orchestration. Voice is a modality, not an
 * agent — the user's selected agent stays active; the voiceMode flag
 * flows through sendText and the server appends the voice overlay onto
 * that agent's system prompt.
 */
export function useVoiceOrchestration(
  options: UseVoiceOrchestrationOptions,
): UseVoiceOrchestrationResult {
  const { sendTextRef } = options;
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceOverlayOpen, setVoiceOverlayOpen] = useState(false);
  // Per-user Piper voice choice. Starts at the default to keep SSR/first
  // render deterministic, then hydrates from localStorage after mount.
  const [voiceId, setVoiceId] = useState<string>(DEFAULT_VOICE_ID);
  useEffect(() => {
    setVoiceId(loadVoicePreference());
  }, []);
  const handleSelectVoice = useCallback((id: string) => {
    setVoiceId(id);
    saveVoicePreference(id);
  }, []);

  const handleVoiceSend = useCallback(
    async (transcript: string) => {
      // Voice is a modality, not an agent. We keep the user's selected
      // agent and just flip the voiceMode flag — the server appends the
      // voice overlay onto that agent's system prompt.
      //
      // Stream the reply into TTS sentence-by-sentence so it starts
      // speaking ~1 sentence in, instead of waiting for the whole answer.
      // `spokenPtr` tracks how much of the cumulative spoken text we've
      // already queued; each delta yields any newly-completed sentences.
      let spokenPtr = 0;
      const flushSentences = (full: string) => {
        if (full.length < spokenPtr) return; // safety: never go backwards
        const { sentences, consumed } = extractSentences(full.slice(spokenPtr));
        if (consumed > 0) spokenPtr += consumed;
        for (const s of sentences) voiceChatRef.current?.speakChunk(s);
      };
      try {
        const send = sendTextRef.current;
        const response = send
          ? await send(transcript, [], {
              voiceMode: true,
              onVoiceDelta: flushSentences,
            })
          : null;
        // Flush the trailing partial (a final sentence without terminal
        // punctuation).
        if (response) {
          const tail = response.slice(spokenPtr).trim();
          if (tail) voiceChatRef.current?.speakChunk(tail);
        }
      } finally {
        // Always mark the reply complete — even on error/throw — so TTS
        // hands back to listening and the mic never strands "off".
        voiceChatRef.current?.endResponse();
      }
    },
    [sendTextRef],
  );

  const voiceChat = useVoiceChat({
    enabled: voiceOverlayOpen,
    onSendMessage: handleVoiceSend,
    voiceId,
  });
  const voiceChatRef = useRef(voiceChat);
  useEffect(() => {
    voiceChatRef.current = voiceChat;
  }, [voiceChat]);

  const handleVoiceToggleMute = useCallback(() => {
    setVoiceMuted((prev) => {
      const next = !prev;
      if (next) voiceChat.pauseConversation();
      else voiceChat.resumeConversation();
      return next;
    });
  }, [voiceChat]);

  // Belt-and-suspenders cleanup: every code path that closes the voice
  // overlay should already call stopConversation, but if any future
  // close path forgets (or a streamed reply lands AFTER the user
  // closes), we still want speech + recognition to shut down. Driving
  // it off voiceOverlayOpen guarantees no orphan TTS keeps narrating
  // once the window is gone.
  useEffect(() => {
    if (voiceOverlayOpen) return;
    voiceChatRef.current?.stopConversation();
  }, [voiceOverlayOpen]);

  return {
    voiceChat,
    voiceMuted,
    setVoiceMuted,
    voiceOverlayOpen,
    setVoiceOverlayOpen,
    voiceId,
    handleSelectVoice,
    handleVoiceToggleMute,
  };
}
