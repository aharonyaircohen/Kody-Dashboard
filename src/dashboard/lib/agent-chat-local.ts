/**
 * @fileType lib
 * @domain kody
 * @pattern agent-chat-local-cache
 *
 * localStorage-backed persistence for agent-scoped chat messages, keyed by
 * agent slug. Mirrors `capability-chat-local.ts` shape.
 *
 * Why local-only: agent are markdown files with no per-member branch
 * (unlike tasks), and there is no server-side agent-chat persistence API.
 * Reloads would otherwise wipe the conversation. Local cache covers
 * single-device continuity; cross-device sync would need a dedicated
 * load/save endpoint (deferred — the per-device case covers ~all real usage).
 */

import type { ChatMessage } from "./chat-types";
import { readActiveRepoScope } from "./active-repo";

const KEY_PREFIX = "kody-agent-chat-";

/**
 * Cache keys are scoped per repo (URL-first — see active-repo.ts) so agent
 * slug "foo" in repo A must not share a localStorage slot with the same slug
 * in repo B. Falls back to an unscoped key when no repo is known (e.g.
 * logged out / SSR).
 */
function repoScope(): string {
  const scope = readActiveRepoScope();
  return scope ? `${scope}:` : "";
}

function key(slug: string): string {
  return `${KEY_PREFIX}${repoScope()}${slug}`;
}

export function loadStaffChatLocal(slug: string): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStaffChatLocal(
  slug: string,
  messages: ChatMessage[],
): void {
  if (typeof window === "undefined") return;
  try {
    if (messages.length === 0) {
      localStorage.removeItem(key(slug));
      return;
    }
    localStorage.setItem(key(slug), JSON.stringify(messages));
  } catch {
    // Quota or serialization error — ignore.
  }
}

export function clearStaffChatLocal(slug: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key(slug));
  } catch {
    // ignore
  }
}
