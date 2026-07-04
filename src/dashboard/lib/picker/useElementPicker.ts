/**
 * @fileType hook
 * @domain picker
 * @pattern extension-bridge
 * @ai-summary Detects the Kody Preview Inspector extension and exposes its
 *   capabilities — pick an element, collect console errors / failed requests,
 *   capture a screenshot. All cross-frame work happens in the extension; this
 *   just talks to its bridge over window.postMessage.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PICKER_EXT_SOURCE,
  PICKER_PAGE_SOURCE,
  composeActTimeoutError,
  type LogEntry,
  type NetworkEntry,
  type PageInfo,
  type PerfReport,
  type PickedElement,
  type PickerExtMessage,
  type PreviewAction,
  type PreviewActResult,
  type PreviewEditCommand,
  type PreviewEditResult,
  type RecordedStep,
} from "./protocol";
import { prepareScreenshotDataUrl, type ScreenshotClip } from "./screenshot";
import {
  hasRecordedSteps,
  pickRecordingResult,
  type RecordingResult,
} from "./recording";

interface UseElementPickerOptions {
  /** Fired once per click, after the picker auto-disarms. */
  onSelect: (element: PickedElement) => void;
}

/** Result of a screenshot attempt — a data URL, or the reason it failed. */
export type ScreenshotResult = {
  dataUrl?: string;
  mimeType?: string;
  error?: string;
};

interface ElementPicker {
  /** True once the extension's bridge answers (installed + on this page). */
  available: boolean;
  /** True while the picker is listening for a click in the preview. */
  armed: boolean;
  arm: () => void;
  disarm: () => void;
  toggle: () => void;
  /** Live count of console errors/warnings buffered in the preview. */
  logCount: number;
  /** Live count of failed requests buffered in the preview. */
  networkCount: number;
  /** Pull the console errors/warnings buffered from the preview frame(s). */
  collectLogs: () => Promise<LogEntry[]>;
  /** Pull the failed requests buffered from the preview frame(s). */
  collectNetwork: () => Promise<NetworkEntry[]>;
  /** Capture the visible tab as a bounded image data URL, cropped to `clip`. */
  captureScreenshot: (clip?: ScreenshotClip) => Promise<ScreenshotResult>;
  /** Snapshot the preview's load performance + slowest resources. */
  collectPerf: () => Promise<PerfReport | null>;
  /**
   * Read the preview's current page context (URL, title, selected text, DOM
   * outline). `timeoutMs` lets callers bound the wait — useful for on-send
   * auto-attach where 1.5s is too long if no preview frame exists.
   */
  collectPage: (timeoutMs?: number) => Promise<PageInfo | null>;
  /**
   * Execute a chat-driven action (click/fill/navigate/scroll/wait) in the
   * preview. Resolves with `{ok, info}` where `info` is a fresh post-action
   * page snapshot the model can read.
   */
  act: (action: PreviewAction, timeoutMs?: number) => Promise<PreviewActResult>;
  /** Apply a temporary visual/content edit inside the preview frame. */
  editPreview: (
    command: PreviewEditCommand,
    timeoutMs?: number,
  ) => Promise<PreviewEditResult>;
  /** Undo the most recent temporary edit in the preview frame. */
  undoPreviewEdit: (timeoutMs?: number) => Promise<PreviewEditResult>;
  /** Reset temporary preview edits. Selector omitted = reset all edits. */
  resetPreviewEdits: (
    selector?: string,
    timeoutMs?: number,
  ) => Promise<PreviewEditResult>;
  /** True while recording a click-through into a test. */
  recording: boolean;
  /** Live count of recorded steps. */
  recStepCount: number;
  startRecording: () => void;
  /** Stop recording and resolve the captured steps + start URL. */
  stopRecording: () => Promise<{ steps: RecordedStep[]; url: string } | null>;
}

type PageMessageType =
  | "ping"
  | "arm"
  | "disarm"
  | "collect-logs"
  | "collect-network"
  | "collect-perf"
  | "collect-page"
  | "preview-edit-undo"
  | "preview-edit-reset"
  | "record-start"
  | "record-stop"
  | "screenshot";

function postToExtension(
  type: PageMessageType,
  extra: Record<string, unknown> = {},
): void {
  if (typeof window === "undefined") return;
  window.postMessage(
    { source: PICKER_PAGE_SOURCE, type, ...extra },
    window.location.origin,
  );
}

export function useElementPicker(opts: UseElementPickerOptions): ElementPicker {
  const [available, setAvailable] = useState(false);
  const [armed, setArmed] = useState(false);
  const [logCount, setLogCount] = useState(0);
  const [networkCount, setNetworkCount] = useState(0);
  const [recording, setRecording] = useState(false);
  const [recStepCount, setRecStepCount] = useState(0);

  // Keep the latest callback without re-subscribing the message listener.
  const onSelectRef = useRef(opts.onSelect);
  onSelectRef.current = opts.onSelect;

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Synchronous detection: the bridge stamps this on <html> at load.
    if (document.documentElement.dataset.kodyPicker) setAvailable(true);

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as PickerExtMessage | undefined;
      if (!data || data.source !== PICKER_EXT_SOURCE) return;

      switch (data.type) {
        case "pong":
          setAvailable(true);
          break;
        case "armed":
          setArmed(true);
          break;
        case "disarmed":
          setArmed(false);
          break;
        case "selected":
          setArmed(false);
          onSelectRef.current(data.element);
          break;
        case "counts":
          setLogCount(data.logs);
          setNetworkCount(data.network);
          break;
        case "rec-count":
          setRecStepCount(data.count);
          break;
      }
    };

    window.addEventListener("message", onMessage);
    // Async detection fallback (marker may not be set yet at this tick).
    postToExtension("ping");

    return () => {
      window.removeEventListener("message", onMessage);
      // Leave nothing armed if the surface unmounts mid-pick.
      postToExtension("disarm");
    };
  }, []);

  const arm = useCallback(() => postToExtension("arm"), []);
  const disarm = useCallback(() => postToExtension("disarm"), []);
  const toggle = useCallback(() => {
    if (armed) disarm();
    else arm();
  }, [armed, arm, disarm]);

  // Sub-frame buffers reply asynchronously; gather everything that arrives in a
  // short window (the preview is usually one frame, but ads/embeds add more).
  const collect = useCallback(
    <T>(
      request: "collect-logs" | "collect-network",
      replyType: "logs" | "network",
    ): Promise<T[]> =>
      new Promise((resolve) => {
        const acc: T[] = [];
        const handler = (event: MessageEvent) => {
          if (event.source !== window) return;
          const data = event.data as PickerExtMessage | undefined;
          if (!data || data.source !== PICKER_EXT_SOURCE) return;
          if (data.type === replyType) {
            acc.push(...(data.entries as unknown[] as T[]));
          }
        };
        window.addEventListener("message", handler);
        postToExtension(request);
        setTimeout(() => {
          window.removeEventListener("message", handler);
          resolve(acc);
        }, 600);
      }),
    [],
  );

  const collectLogs = useCallback(
    () => collect<LogEntry>("collect-logs", "logs"),
    [collect],
  );
  const collectNetwork = useCallback(
    () => collect<NetworkEntry>("collect-network", "network"),
    [collect],
  );

  const captureScreenshot = useCallback(
    (clip?: ScreenshotClip): Promise<ScreenshotResult> =>
      new Promise((resolve) => {
        const handler = async (event: MessageEvent) => {
          if (event.source !== window) return;
          const data = event.data as PickerExtMessage | undefined;
          if (!data || data.source !== PICKER_EXT_SOURCE) return;
          if (data.type !== "screenshot") return;
          window.removeEventListener("message", handler);
          clearTimeout(timer);
          if (!data.dataUrl) {
            resolve({ error: data.error ?? "capture returned no image" });
            return;
          }
          try {
            const screenshot = await prepareScreenshotDataUrl(
              data.dataUrl,
              clip,
            );
            resolve({
              dataUrl: screenshot.dataUrl,
              mimeType: screenshot.mimeType,
            });
          } catch {
            resolve({ dataUrl: data.dataUrl, mimeType: "image/png" });
          }
        };
        window.addEventListener("message", handler);
        postToExtension("screenshot");
        const timer = setTimeout(() => {
          window.removeEventListener("message", handler);
          resolve({ error: "timed out (is the extension reloaded?)" });
        }, 6000);
      }),
    [],
  );

  const collectPerf = useCallback(
    (): Promise<PerfReport | null> =>
      new Promise((resolve) => {
        const handler = (event: MessageEvent) => {
          if (event.source !== window) return;
          const data = event.data as PickerExtMessage | undefined;
          if (!data || data.source !== PICKER_EXT_SOURCE) return;
          if (data.type !== "perf") return;
          window.removeEventListener("message", handler);
          clearTimeout(timer);
          resolve(data.report);
        };
        window.addEventListener("message", handler);
        postToExtension("collect-perf");
        const timer = setTimeout(() => {
          window.removeEventListener("message", handler);
          resolve(null);
        }, 1500);
      }),
    [],
  );

  // Picks the first reply from any sub-frame; preview is one frame so that's
  // fine. If multiple frames replied we'd want the largest one, but no caller
  // needs that today.
  const collectPage = useCallback(
    (timeoutMs: number = 1500): Promise<PageInfo | null> =>
      new Promise((resolve) => {
        const handler = (event: MessageEvent) => {
          if (event.source !== window) return;
          const data = event.data as PickerExtMessage | undefined;
          if (!data || data.source !== PICKER_EXT_SOURCE) return;
          if (data.type !== "page") return;
          window.removeEventListener("message", handler);
          clearTimeout(timer);
          resolve(data.info);
        };
        window.addEventListener("message", handler);
        postToExtension("collect-page");
        const timer = setTimeout(() => {
          window.removeEventListener("message", handler);
          resolve(null);
        }, timeoutMs);
      }),
    [],
  );

  const act = useCallback(
    (action: PreviewAction, timeoutMs?: number): Promise<PreviewActResult> =>
      new Promise((resolve) => {
        if (typeof window === "undefined") {
          resolve({ ok: false, error: "no window" });
          return;
        }
        // Adaptive default:
        //   - wait: ms + 1s grace
        //   - navigate: 8s — extension hands off via sessionStorage, the
        //     new page's content script delivers the result after load
        //     (we need to wait long enough for a real page load + render).
        //   - everything else: 3s — sub-frames stay silent on selector
        //     misses so a tight bound surfaces "not found" quickly.
        const effectiveTimeout =
          timeoutMs ??
          (action.op === "wait"
            ? (action.ms ?? 200) + 1000
            : action.op === "navigate"
              ? 8000
              : 3000);
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const handler = (event: MessageEvent) => {
          if (event.source !== window) return;
          const data = event.data as PickerExtMessage | undefined;
          if (!data || data.source !== PICKER_EXT_SOURCE) return;
          if (data.type !== "act-result") return;
          if (data.requestId !== requestId) return;
          window.removeEventListener("message", handler);
          clearTimeout(timer);
          resolve({ ok: data.ok, error: data.error, info: data.info });
        };
        window.addEventListener("message", handler);
        window.postMessage(
          {
            source: PICKER_PAGE_SOURCE,
            type: "act",
            payload: action,
            requestId,
          },
          window.location.origin,
        );
        const timer = setTimeout(() => {
          window.removeEventListener("message", handler);
          resolve({
            ok: false,
            error: composeActTimeoutError(action, effectiveTimeout),
          });
        }, effectiveTimeout);
      }),
    [],
  );

  const runPreviewEditCommand = useCallback(
    (
      type: "preview-edit" | "preview-edit-undo" | "preview-edit-reset",
      payload?: unknown,
      timeoutMs: number = 1500,
    ): Promise<PreviewEditResult> =>
      new Promise((resolve) => {
        if (typeof window === "undefined") {
          resolve({ ok: false, error: "no window" });
          return;
        }
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const handler = (event: MessageEvent) => {
          if (event.source !== window) return;
          const data = event.data as PickerExtMessage | undefined;
          if (!data || data.source !== PICKER_EXT_SOURCE) return;
          if (data.type !== "preview-edit-result") return;
          if (data.requestId !== requestId) return;
          window.removeEventListener("message", handler);
          clearTimeout(timer);
          resolve({ ok: data.ok, error: data.error });
        };
        window.addEventListener("message", handler);
        window.postMessage(
          {
            source: PICKER_PAGE_SOURCE,
            type,
            payload,
            requestId,
          },
          window.location.origin,
        );
        const timer = setTimeout(() => {
          window.removeEventListener("message", handler);
          resolve({
            ok: false,
            error: "selector not found in any preview frame",
          });
        }, timeoutMs);
      }),
    [],
  );

  const editPreview = useCallback(
    (command: PreviewEditCommand, timeoutMs?: number) =>
      runPreviewEditCommand("preview-edit", command, timeoutMs),
    [runPreviewEditCommand],
  );

  const undoPreviewEdit = useCallback(
    (timeoutMs?: number) =>
      runPreviewEditCommand("preview-edit-undo", undefined, timeoutMs),
    [runPreviewEditCommand],
  );

  const resetPreviewEdits = useCallback(
    (selector?: string, timeoutMs?: number) =>
      runPreviewEditCommand(
        "preview-edit-reset",
        selector ? { selector } : undefined,
        timeoutMs,
      ),
    [runPreviewEditCommand],
  );

  const startRecording = useCallback(() => {
    setRecStepCount(0);
    setRecording(true);
    postToExtension("record-start");
  }, []);

  const stopRecording = useCallback(
    (): Promise<{ steps: RecordedStep[]; url: string } | null> =>
      new Promise((resolve) => {
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        let best: RecordingResult | null = null;
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let handler: (event: MessageEvent) => void = () => {};
        const settle = (result: RecordingResult | null) => {
          if (settled) return;
          settled = true;
          window.removeEventListener("message", handler);
          if (timer) clearTimeout(timer);
          setRecording(false);
          resolve(hasRecordedSteps(result) ? result : null);
        };
        handler = (event: MessageEvent) => {
          if (event.source !== window) return;
          const data = event.data as PickerExtMessage | undefined;
          if (!data || data.source !== PICKER_EXT_SOURCE) return;
          if (data.type !== "recording") return;
          if (data.requestId && data.requestId !== requestId) return;
          best = pickRecordingResult(best, {
            steps: data.steps,
            url: data.url,
          });
          if (data.steps.length > 0) settle(best);
        };
        window.addEventListener("message", handler);
        postToExtension("record-stop", { requestId });
        timer = setTimeout(() => {
          settle(best);
        }, 1500);
      }),
    [],
  );

  return {
    available,
    armed,
    arm,
    disarm,
    toggle,
    logCount,
    networkCount,
    collectLogs,
    collectNetwork,
    captureScreenshot,
    collectPerf,
    collectPage,
    act,
    editPreview,
    undoPreviewEdit,
    resetPreviewEdits,
    recording,
    recStepCount,
    startRecording,
    stopRecording,
  };
}
