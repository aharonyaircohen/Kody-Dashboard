/**
 * @fileType utility
 * @domain kody
 * @pattern auth
 * @ai-summary Transient handoff between the OAuth completion page and RepoManager.
 *
 * After GitHub App sign-in, the completion page parks the user token + identity
 * in sessionStorage under this key. RepoManager picks it up to connect a repo
 * without a pasted PAT, then clears it. sessionStorage (not localStorage) so it
 * dies with the tab if the flow is abandoned.
 */
export const PENDING_OAUTH_KEY = "kody_pending_oauth";

export interface PendingOAuth {
  token: string;
  login: string;
  id: number;
  avatar: string;
}

/** Read + parse the pending login, or null if absent/corrupt. */
export function readPendingOAuth(): PendingOAuth | null {
  try {
    const raw = sessionStorage.getItem(PENDING_OAUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingOAuth;
    return parsed.token && parsed.login ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPendingOAuth(): void {
  try {
    sessionStorage.removeItem(PENDING_OAUTH_KEY);
  } catch {
    // sessionStorage unavailable — nothing to clear.
  }
}
