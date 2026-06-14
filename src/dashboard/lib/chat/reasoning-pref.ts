/**
 * @fileType util
 * @domain kody
 * @pattern local-pref
 * @ai-summary Per-user, repo-scoped, per-model persistence for the chat
 *   thinking level. The chat header shows a `🧠 Low ▾` dropdown; the pick
 *   lives in localStorage, scoped by (repo, modelId) so a "High on Claude"
 *   doesn't bleed into a "Low on GPT-5" the next time the user swaps.
 *
 *   Mirrors the structure of `default-entry.ts`. Models that don't declare
 *   a `reasoning` block never reach this file — the dropdown isn't rendered
 *   in the first place.
 */

import type { ModelReasoning } from "./reasoning-adapter";

const REASONING_EFFORT_KEY_BASE = "kody-reasoning-effort";

function repoSuffix(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem("kody_auth");
    if (!raw) return "";
    const auth = JSON.parse(raw) as { owner?: string; repo?: string };
    if (!auth.owner || !auth.repo) return "";
    return `:${auth.owner.toLowerCase()}/${auth.repo.toLowerCase()}`;
  } catch {
    return "";
  }
}

function storageKey(modelId: string): string {
  return `${REASONING_EFFORT_KEY_BASE}:${modelId}${repoSuffix()}`;
}

/**
 * The user's saved effort for this (repo, modelId), or `null` when none
 * is set — caller should fall back to `reasoning.default`.
 */
export function readReasoningEffort(
  modelId: string | null | undefined,
): string | null {
  if (typeof window === "undefined" || !modelId) return null;
  try {
    return window.localStorage.getItem(storageKey(modelId));
  } catch {
    return null;
  }
}

/** Persist the user's effort for this (repo, modelId). */
export function writeReasoningEffort(modelId: string, effort: string): void {
  if (typeof window === "undefined" || !modelId) return;
  try {
    window.localStorage.setItem(storageKey(modelId), effort);
  } catch {
    // localStorage unavailable — non-fatal.
  }
}

/** Resolve the effective effort: stored pick → model's `reasoning.default` → null. */
export function resolveEffort(
  modelId: string | null | undefined,
  reasoning: ModelReasoning | null | undefined,
): string | null {
  if (!modelId || !reasoning) return null;
  const stored = readReasoningEffort(modelId);
  if (stored && reasoning.efforts.some((e) => e.value === stored))
    return stored;
  return reasoning.default;
}
