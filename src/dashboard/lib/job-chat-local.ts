/**
 * @fileType lib
 * @domain kody
 * @pattern job-chat-local-cache
 *
 * localStorage-backed persistence for job-scoped chat messages, keyed by
 * job slug. Mirrors `task-chat-local.ts` shape.
 *
 * Why local-only: jobs are markdown files with no per-job branch (unlike
 * tasks), and there is no server-side job-chat persistence API. Reloads
 * would otherwise wipe the conversation. Local cache covers single-device
 * continuity; cross-device sync would need a dedicated load/save endpoint
 * (deferred — the per-device case covers ~all real usage).
 */

import type { ChatMessage } from './chat-types'

const KEY_PREFIX = 'kody-job-chat-'

function key(slug: string): string {
  return `${KEY_PREFIX}${slug}`
}

export function loadJobChatLocal(slug: string): ChatMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(key(slug))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveJobChatLocal(slug: string, messages: ChatMessage[]): void {
  if (typeof window === 'undefined') return
  try {
    if (messages.length === 0) {
      localStorage.removeItem(key(slug))
      return
    }
    localStorage.setItem(key(slug), JSON.stringify(messages))
  } catch {
    // Quota or serialization error — ignore.
  }
}

export function clearJobChatLocal(slug: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(key(slug))
  } catch {
    // ignore
  }
}
