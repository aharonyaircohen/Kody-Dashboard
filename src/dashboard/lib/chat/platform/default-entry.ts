/**
 * @fileType util
 * @domain kody
 * @pattern local-pref
 * @ai-summary Per-user (repo-scoped) localStorage persistence for the default
 *   chat entry — the agent/model that loads when chat opens. Written from
 *   Settings → "Default chat"; read on mount by the chat picker (KodyChat).
 *
 * The default is a *per-user* preference (each person picks their own starting
 * agent), so it lives in localStorage — repo-scoped so a default chosen for
 * repo A doesn't bleed into repo B. Previously this was repo-shared in
 * `.kody/dashboard.json`, which meant one user's pick silently changed the
 * default for everyone.
 */

import { readActiveRepoScope } from "../../active-repo";

const DEFAULT_CHAT_ENTRY_KEY_BASE = "kody-default-chat-entry";

/** Repo-scoped storage key (URL-first — see active-repo.ts). */
export function defaultChatEntryStorageKey(): string {
  const scope = readActiveRepoScope();
  if (!scope) return DEFAULT_CHAT_ENTRY_KEY_BASE;
  return `${DEFAULT_CHAT_ENTRY_KEY_BASE}:${scope}`;
}

/** The saved default entry key, or null when none is set (automatic). */
export function readDefaultChatEntry(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(defaultChatEntryStorageKey());
  } catch {
    return null;
  }
}

/** Persist the default entry key for the connected repo. */
export function writeDefaultChatEntry(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(defaultChatEntryStorageKey(), key);
  } catch {
    // localStorage unavailable/full — non-fatal, the pick just won't persist.
  }
}

/** Remove the saved default so chat falls back to automatic selection. */
export function clearDefaultChatEntry(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(defaultChatEntryStorageKey());
  } catch {
    // localStorage unavailable — non-fatal.
  }
}
