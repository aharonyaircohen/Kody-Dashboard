/**
 * @fileType hook
 * @domain kody
 * @pattern mention-roster
 * @ai-summary Single source of truth for the `@`-mention autocomplete
 *   list, shared by every composer (channels, goals, and any future
 *   surface). Merges repo collaborators with the staff roster so
 *   personas like `@cto` are offered everywhere — not just in Messages.
 *   Staff are tagged `isStaff` so the UI can badge them; a staff
 *   mention dispatches a one-shot tick server-side (see
 *   staff-mention-dispatch.ts).
 */
"use client";

import { useMemo } from "react";
import { useCollaborators } from "./index";
import { useStaff } from "./useStaff";

export interface MentionEntry {
  login: string;
  avatar_url: string;
  /** True for staff personas — mentioning one dispatches an ad-hoc tick. */
  isStaff?: boolean;
}

/**
 * Collaborators + staff + the signed-in user, de-duplicated. People
 * rank first; staff are appended (and win a slug/login collision on
 * dispatch, resolved server-side). Self is always included so you can
 * self-mention even on a bot-only/private repo.
 */
export function useMentionRoster(self?: {
  login?: string;
  avatar_url?: string;
}): MentionEntry[] {
  const { data: collaborators } = useCollaborators();
  const { data: staff } = useStaff();

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

    for (const w of staff ?? []) {
      if (!merged.some((m) => m.login === w.slug && m.isStaff)) {
        merged.push({ login: w.slug, avatar_url: "", isStaff: true });
      }
    }
    return merged;
  }, [collaborators, staff, self?.login, self?.avatar_url]);
}
