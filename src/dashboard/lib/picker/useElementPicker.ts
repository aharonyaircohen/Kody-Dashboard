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
  type LogEntry,
  type NetworkEntry,
  type PageInfo,
  type PerfReport,
  type PickedElement,
  type PickerExtMessage,
  type RecordedStep,
} from "./protocol";

interface UseElementPickerOptions {
  /** Fired once per click, after the picker auto-disarms. */
  onSelect: (element: PickedElement) => void;
}

/** A clip rectangle (CSS pixels, viewport-relative) to crop a screenshot to. */
export interface ScreenshotClip {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Result of a screenshot attempt — a data URL, or the reason it failed. */
export type ScreenshotResult = { dataUrl?: string; error?: string };

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
  /** Capture the visible tab as a PNG data URL, optionally cropped to `clip`. */
  captureScreenshot: (clip?: ScreenshotClip) => Promise<ScreenshotResult>;
  /** Snapshot the preview's load performance + slowest resources. */
  collectPerf: () => Promise<PerfReport | null>;
  /**
   * Read the preview's current page context (URL, title, selected text, DOM
   * outline). `timeoutMs` lets callers bound the wait — useful for on-send
   * auto-attach where 1.5s is too long if no preview frame exists.
   */
  collectPage: (timeoutMs?: number) => Promise<PageInfo | null>;
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
  | "record-start"
  | "record-stop"
  | "screenshot";

function postToExtension(type: PageMessageType): void {
  if (typeof window === "undefined") return;
  window.postMessage(
    { source: PICKER_PAGE_SOURCE, type },
    window.location.origin,
  );
}

/** Crop a PNG data URL to a CSS-pixel rect (scaled by devicePixelRatio). */
async function cropDataUrl(
  dataUrl: string,
  clip: ScreenshotClip,
): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = dataUrl;
  });
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(clip.width * dpr));
  canvas.height = Math.max(1, Math.round(clip.height * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(
    img,
    clip.x * dpr,
    clip.y * dpr,
    clip.width * dpr,
    clip.height * dpr,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas.toDataURL("image/png");
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
            resolve({
              dataUrl: clip
                ? await cropDataUrl(data.dataUrl, clip)
                : data.dataUrl,
            });
          } catch {
            resolve({ dataUrl: data.dataUrl });
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

  const startRecording = useCallback(() => {
    setRecStepCount(0);
    setRecording(true);
    postToExtension("record-start");
  }, []);

  const stopRecording = useCallback(
    (): Promise<{ steps: RecordedStep[]; url: string } | null> =>
      new Promise((resolve) => {
        const handler = (event: MessageEvent) => {
          if (event.source !== window) return;
          const data = event.data as PickerExtMessage | undefined;
          if (!data || data.source !== PICKER_EXT_SOURCE) return;
          if (data.type !== "recording") return;
          window.removeEventListener("message", handler);
          clearTimeout(timer);
          setRecording(false);
          resolve({ steps: data.steps, url: data.url });
        };
        window.addEventListener("message", handler);
        postToExtension("record-stop");
        const timer = setTimeout(() => {
          window.removeEventListener("message", handler);
          setRecording(false);
          resolve(null);
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
    recording,
    recStepCount,
    startRecording,
    stopRecording,
  };
}
