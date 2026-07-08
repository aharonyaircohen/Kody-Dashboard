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

const DEFAULT_CHAT_ENTRY_KEY_BASE = "kody-default-chat-entry";

/** Repo-scoped storage key, derived from the connected repo in `kody_auth`. */
export function defaultChatEntryStorageKey(): string {
  if (typeof window === "undefined") return DEFAULT_CHAT_ENTRY_KEY_BASE;
  try {
    const raw = window.localStorage.getItem("kody_auth");
    if (!raw) return DEFAULT_CHAT_ENTRY_KEY_BASE;
    const auth = JSON.parse(raw) as { owner?: string; repo?: string };
    if (!auth.owner || !auth.repo) return DEFAULT_CHAT_ENTRY_KEY_BASE;
    return `${DEFAULT_CHAT_ENTRY_KEY_BASE}:${auth.owner.toLowerCase()}/${auth.repo.toLowerCase()}`;
  } catch {
    return DEFAULT_CHAT_ENTRY_KEY_BASE;
  }
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
