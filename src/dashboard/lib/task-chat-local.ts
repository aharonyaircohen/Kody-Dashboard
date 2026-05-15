/**
 * @fileType lib
 * @domain kody
 * @pattern task-chat-local-cache
 *
 * localStorage mirror of dashboard-stage task chat messages.
 *
 * Why: server save (`/api/kody/chat/save`) only persists when a task has a
 * pipeline branch. Tasks still in Backlog (no branch yet) silently no-op,
 * so a refresh wipes the chat. This local cache covers that gap. Once the
 * server save succeeds (branch exists), we drop the local entry — server
 * is canonical from then on.
 */

import type { ChatMessage } from "./chat-types";

const KEY_PREFIX = "kody-task-chat-";

/**
 * Read the connected repo from localStorage.kody_auth so cache keys are
 * scoped per repo — issue #N in repo A must not share a localStorage slot
 * with issue #N in repo B. Falls back to an unscoped key when no repo is
 * known (e.g. logged out / SSR).
 */
function repoScope(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem("kody_auth");
    if (!raw) return "";
    const auth = JSON.parse(raw) as { owner?: string; repo?: string };
    if (!auth.owner || !auth.repo) return "";
    return `${auth.owner.toLowerCase()}/${auth.repo.toLowerCase()}:`;
  } catch {
    return "";
  }
}

function key(taskId: string): string {
  return `${KEY_PREFIX}${repoScope()}${taskId}`;
}

export function loadTaskChatLocal(taskId: string): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key(taskId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTaskChatLocal(
  taskId: string,
  messages: ChatMessage[],
): void {
  if (typeof window === "undefined") return;
  try {
    if (messages.length === 0) {
      localStorage.removeItem(key(taskId));
      return;
    }
    localStorage.setItem(key(taskId), JSON.stringify(messages));
  } catch {
    // Quota or serialization error — ignore (server save still runs).
  }
}

export function clearTaskChatLocal(taskId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key(taskId));
  } catch {
    // ignore
  }
}
