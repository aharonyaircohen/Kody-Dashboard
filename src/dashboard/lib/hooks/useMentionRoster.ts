/**
 * @fileType hook
 * @domain kody
 * @pattern mention-roster
 * @ai-summary Single source of truth for the `@`-mention autocomplete
 *   list, shared by every composer (channels, goals, and any future
 *   surface). Merges repo collaborators with the worker roster so
 *   personas like `@cto` are offered everywhere — not just in Messages.
 *   Workers are tagged `isWorker` so the UI can badge them; a worker
 *   mention dispatches a one-shot tick server-side (see
 *   worker-mention-dispatch.ts).
 */
"use client";

import { useMemo } from "react";
import { useCollaborators } from "./index";
import { useWorkers } from "./useWorkers";

export interface MentionEntry {
  login: string;
  avatar_url: string;
  /** True for worker personas — mentioning one dispatches an ad-hoc tick. */
  isWorker?: boolean;
}

/**
 * Collaborators + workers + the signed-in user, de-duplicated. People
 * rank first; workers are appended (and win a slug/login collision on
 * dispatch, resolved server-side). Self is always included so you can
 * self-mention even on a bot-only/private repo.
 */
export function useMentionRoster(
  self?: { login?: string; avatar_url?: string },
): MentionEntry[] {
  const { data: collaborators } = useCollaborators();
  const { data: workers } = useWorkers();

  return useMemo(() => {
    const merged: MentionEntry[] = (collaborators ?? []).map((c) => ({
      login: c.login,
      avatar_url: c.avatar_url,
    }));

    if (self?.login && !merged.some((m) => m.login === self.login)) {
      merged.unshift({
        login: self.login,
        avatar_url: self.avatar_url ?? "",
      });
    }

    for (const w of workers ?? []) {
      if (!merged.some((m) => m.login === w.slug && m.isWorker)) {
        merged.push({ login: w.slug, avatar_url: "", isWorker: true });
      }
    }
    return merged;
  }, [collaborators, workers, self?.login, self?.avatar_url]);
}
