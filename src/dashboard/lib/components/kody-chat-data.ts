/**
 * @fileType hook
 * @domain kody
 * @pattern kody-chat-data
 * @ai-summary KodyChat's async data sources extracted from KodyChat
 *   (phase 1.6c): the user-managed chat model list (/api/kody/models),
 *   the repo-wide dashboard config toggle (brainFlyChatEnabled), and the
 *   per-repo FLY_API_TOKEN vault probe. All three load once on mount and
 *   fail silent — chat keeps working through the engine path with the
 *   affected dropdown rows hidden. Behavior is identical to the
 *   pre-extraction inline effects.
 *
 *   Placement note: lives in components/ next to the other phase-1.6
 *   extractions (kody-chat-live-runner.ts / kody-chat-send.ts) — it is
 *   KodyChat wiring, not reusable chat/core logic.
 */
"use client";

import { useEffect, useState } from "react";
import type { ChatModelEntry } from "../chat/platform/agent-entries";
import { authHeaders } from "../chat/core/kody-chat-live-session";

export interface ChatDataSources {
  /**
   * User-managed chat models from /api/kody/models (LLM_MODELS variable).
   * Empty until first load completes; renders only Kody Live (+ Brain) in
   * the dropdown while empty.
   */
  chatModels: ChatModelEntry[];
  chatModelsLoaded: boolean;
  /**
   * Per-repo opt-in for the "Repo Brain" chat row (state repo
   * dashboard.json, default false). Chat-only — does NOT gate Fly task
   * execution.
   */
  brainFlyChatEnabled: boolean;
  /**
   * Mirrors brainConfigured: true only when the per-repo vault holds a
   * non-empty FLY_API_TOKEN. The Fly dropdown row is hidden until then so
   * users can't pick a runner that will fail at start-fly time.
   */
  flyConfigured: boolean;
}

/**
 * KodyChat's mount-time data loads. Each fetch runs once per mount and
 * is independently silent on failure (the corresponding feature just
 * stays hidden / disabled, matching the "not configured" state).
 */
export function useChatDataSources(): ChatDataSources {
  const [chatModels, setChatModels] = useState<ChatModelEntry[]>([]);
  const [chatModelsLoaded, setChatModelsLoaded] = useState(false);
  const [brainFlyChatEnabled, setBrainFlyChatEnabled] = useState(false);
  const [flyConfigured, setFlyConfigured] = useState(false);

  // Load the user-managed model list once on mount. The dropdown stays in
  // Kody Live-only mode until this resolves; failures are silent — chat
  // still works through the engine path.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/kody/models", { headers: authHeaders() })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((json: { models?: ChatModelEntry[] }) => {
        if (cancelled) return;
        setChatModels(Array.isArray(json.models) ? json.models : []);
        setChatModelsLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setChatModels([]);
          setChatModelsLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the repo-wide Repo Brain chat toggle once on mount. The default
  // chat entry is no longer fetched here — it's a per-user localStorage
  // preference, read synchronously by the selection hook. Silent on failure.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/kody/dashboard-config", { headers: authHeaders() })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then(
        (json: {
          config?: {
            brainFlyChatEnabled?: boolean;
          };
        }) => {
          if (cancelled) return;
          setBrainFlyChatEnabled(json.config?.brainFlyChatEnabled === true);
        },
      )
      .catch(() => {
        if (!cancelled) setBrainFlyChatEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Probe the per-repo vault for FLY_API_TOKEN so the dropdown can hide the
  // Fly row when no token is configured. Silent on any error — the row just
  // stays hidden, matching the "not configured" state.
  useEffect(() => {
    let cancelled = false;
    const headers = authHeaders();
    if (Object.keys(headers).length === 0) {
      setFlyConfigured(false);
      return;
    }
    fetch("/api/kody/secrets/FLY_API_TOKEN/value", { headers })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setFlyConfigured(false);
          return;
        }
        const body = (await res.json().catch(() => ({}))) as { value?: string };
        setFlyConfigured(Boolean(body.value && body.value.trim().length > 0));
      })
      .catch(() => {
        if (!cancelled) setFlyConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { chatModels, chatModelsLoaded, brainFlyChatEnabled, flyConfigured };
}
