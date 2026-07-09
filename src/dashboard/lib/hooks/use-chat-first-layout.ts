/**
 * @fileType hook
 * @domain layout
 * @pattern per-user-toggle
 * @ai-summary Per-user "chat-first layout (beta)" toggle (phase 2 step 2).
 *   Stored in localStorage (Settings page is per-user by convention),
 *   default ON — with an explicit opt-out the shell renders byte-identically to
 *   the current rail layout. ChatRailShell reads it via the hook; the
 *   Settings card writes it via setChatFirstLayout, which broadcasts a
 *   window event so the shell flips live without a reload.
 */
"use client";

import { useEffect, useState } from "react";

export const CHAT_FIRST_LAYOUT_KEY = "kody:chat-first-layout";
const CHANGE_EVENT = "kody:chat-first-layout-changed";

/**
 * The default when the user has never touched the toggle (absent key /
 * unavailable storage). An explicit "0" (user opted out) still wins.
 */
export const CHAT_FIRST_DEFAULT = true;

/** Read the persisted toggle. Absent key → CHAT_FIRST_DEFAULT; an explicit
 *  stored value always wins; storage failures read as the default. */
export function readChatFirstLayout(): boolean {
  try {
    const raw = localStorage.getItem(CHAT_FIRST_LAYOUT_KEY);
    if (raw === null) return CHAT_FIRST_DEFAULT;
    return raw === "1";
  } catch {
    return CHAT_FIRST_DEFAULT;
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
