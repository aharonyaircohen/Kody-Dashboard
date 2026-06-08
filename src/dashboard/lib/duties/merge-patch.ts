/**
 * @fileType util
 * @domain kody
 * @pattern duty-merge
 * @ai-summary Read-merge a PATCH payload against the existing duty so the
 *   serializer only writes the user's edits. Omit preserves; explicit
 *   `[]` / `null` clears; the rest of the field's normalizer handles
 *   trim/empty-drop.
 *
 *   This is the contract the dashboard's UI relies on: a partial save
 *   never wipes a field the user did not touch. Without it, hitting
 *   "Save" with just a title change would erase the duty's `staff:`
 *   and `mentions:` lines.
 *
 *   The pure form is split out of `app/api/kody/duties/[slug]/route.ts`
 *   so it can be unit-tested without faking the whole request / octokit
 *   stack.
 */

import type { TickFile } from "@dashboard/lib/ticked/files";

/**
 * The PATCH payload's slice of fields that go through read-merge. The
 * rest of the duty (title, body, schedule, disabled, staff) uses
 * `??` against the existing value, so they don't need a custom merger.
 */
export interface DutyMergePatch {
  mentions?: string[];
  executables?: string[];
  dutyTools?: string[];
  tickScript?: string | null;
}

/** The subset of fields this helper actually merges. */
export type DutyMergedFields = Pick<
  TickFile,
  "mentions" | "executables" | "dutyTools" | "tickScript"
>;

/**
 * Apply the dashboard's read-merge contract to a PATCH payload:
 *   - omit (field absent on payload) → preserve existing
 *   - present as empty / null / "" → clear
 *   - otherwise → normalize (trim, drop empties; @-prefix stripped for mentions)
 */
export function mergeDutyPatch(
  existing: DutyMergedFields,
  patch: DutyMergePatch,
): DutyMergedFields {
  return {
    mentions:
      patch.mentions === undefined
        ? existing.mentions
        : normalizeMentions(patch.mentions),
    executables:
      patch.executables === undefined
        ? existing.executables
        : normalizeStringList(patch.executables),
    dutyTools:
      patch.dutyTools === undefined
        ? existing.dutyTools
        : normalizeStringList(patch.dutyTools),
    // An empty string and `null` are both treated as "clear" because a
    // blank script is functionally identical to no line — and a UI
    // textarea submitting "" should not preserve a stale value.
    tickScript:
      patch.tickScript === undefined
        ? existing.tickScript
        : typeof patch.tickScript === "string" && patch.tickScript.length > 0
          ? patch.tickScript
          : null,
  };
}

function normalizeMentions(mentions: string[]): string[] {
  return mentions
    .map((m) => m.trim().replace(/^@/, ""))
    .filter((m) => m.length > 0);
}

function normalizeStringList(values: string[]): string[] {
  return values.map((s) => s.trim()).filter((s) => s.length > 0);
}
