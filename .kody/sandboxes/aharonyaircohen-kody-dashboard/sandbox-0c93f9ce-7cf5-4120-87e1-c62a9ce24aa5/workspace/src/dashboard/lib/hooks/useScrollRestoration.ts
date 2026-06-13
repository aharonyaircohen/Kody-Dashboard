/**
 * @fileType hook
 * @domain kody
 * @pattern scroll-restoration
 * @ai-summary Persists a scroll container's offset across unmount/remount
 *             (e.g. dashboard list → task detail → back) keyed by a string.
 */
"use client";

import { useCallback, useRef } from "react";

// Module-scoped so the position survives the container unmounting entirely
// (the dashboard swaps the whole list subtree for <TaskDetail>). Keyed by a
// caller-supplied signature so different filtered lists don't bleed offsets.
const scrollStore = new Map<string, number>();

/**
 * Returns a callback ref to attach to a scrollable element. While mounted it
 * records `scrollTop` under `key`; on (re)mount it restores the last recorded
 * value for that key. A different `key` (e.g. filters changed) starts at top.
 */
export function useScrollRestoration(key: string) {
  const cleanupRef = useRef<(() => void) | null>(null);
  const keyRef = useRef(key);
  keyRef.current = key;

  return useCallback((node: HTMLElement | null) => {
    // Detach: tear down the previous element's listener/frames.
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (!node) return;

    const onScroll = () => {
      scrollStore.set(keyRef.current, node.scrollTop);
    };
    node.addEventListener("scroll", onScroll, { passive: true });

    // Restore after layout. Returning from detail re-renders with cached list
    // data, so content is present on mount — but run across two frames so any
    // late layout (fonts/images) doesn't clobber the restored offset. The
    // browser clamps to scrollHeight if the list is now shorter.
    const saved = scrollStore.get(keyRef.current) ?? 0;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      node.scrollTop = saved;
      raf2 = requestAnimationFrame(() => {
        node.scrollTop = saved;
      });
    });

    cleanupRef.current = () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      node.removeEventListener("scroll", onScroll);
    };
  }, []);
}
