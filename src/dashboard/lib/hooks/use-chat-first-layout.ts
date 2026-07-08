/**
 * @fileType hook
 * @domain layout
 * @pattern per-user-toggle
 * @ai-summary Per-user "chat-first layout (beta)" toggle (phase 2 step 2).
 *   Stored in localStorage (Settings page is per-user by convention),
 *   default OFF — with the flag off the shell renders byte-identically to
 *   the current rail layout. ChatRailShell reads it via the hook; the
 *   Settings card writes it via setChatFirstLayout, which broadcasts a
 *   window event so the shell flips live without a reload.
 */
"use client";

import { useEffect, useState } from "react";

export const CHAT_FIRST_LAYOUT_KEY = "kody:chat-first-layout";
const CHANGE_EVENT = "kody:chat-first-layout-changed";

/** Read the persisted toggle. Default OFF; storage failures read as OFF. */
export function readChatFirstLayout(): boolean {
  try {
    return localStorage.getItem(CHAT_FIRST_LAYOUT_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist the toggle and notify live subscribers (same tab). */
export function setChatFirstLayout(enabled: boolean): void {
  try {
    localStorage.setItem(CHAT_FIRST_LAYOUT_KEY, enabled ? "1" : "0");
  } catch {
    // localStorage unavailable (private mode) — non-fatal.
  }
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Non-fatal: next mount reads the persisted value.
  }
}

/**
 * Subscribe to the toggle. Starts false (matches SSR markup — same
 * hydration-guard pattern as the shell's other localStorage reads) and
 * syncs on mount + on same-tab changes + cross-tab storage events.
 */
export function useChatFirstLayout(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const sync = () => setEnabled(readChatFirstLayout());
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return enabled;
}
