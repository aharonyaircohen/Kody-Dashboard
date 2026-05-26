/**
 * @fileType hook
 * @domain picker
 * @pattern extension-bridge
 * @ai-summary Detects the Kody Element Picker extension, arms/disarms it, and
 *   surfaces picked elements. All cross-frame work happens in the extension;
 *   this just talks to its bridge over window.postMessage.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PICKER_EXT_SOURCE,
  PICKER_PAGE_SOURCE,
  type PickedElement,
  type PickerExtMessage,
} from "./protocol";

interface UseElementPickerOptions {
  /** Fired once per click, after the picker auto-disarms. */
  onSelect: (element: PickedElement) => void;
}

interface ElementPicker {
  /** True once the extension's bridge answers (installed + on this page). */
  available: boolean;
  /** True while the picker is listening for a click in the preview. */
  armed: boolean;
  arm: () => void;
  disarm: () => void;
  toggle: () => void;
}

function postToExtension(type: "ping" | "arm" | "disarm"): void {
  if (typeof window === "undefined") return;
  window.postMessage(
    { source: PICKER_PAGE_SOURCE, type },
    window.location.origin,
  );
}

export function useElementPicker(opts: UseElementPickerOptions): ElementPicker {
  const [available, setAvailable] = useState(false);
  const [armed, setArmed] = useState(false);

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

  return { available, armed, arm, disarm, toggle };
}
