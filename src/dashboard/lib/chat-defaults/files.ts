/**
 * @fileType util
 * @domain kody
 * @pattern chat-defaults-files
 *
 * File I/O for the chat defaults bundle. Step 1 stub — returns TS defaults
 * only. The repo read will be added in step 2 and gated by an env flag.
 */

import {
  DEFAULT_PERSONA_MD,
  DEFAULT_EXECUTABLE,
  DEFAULT_DUTIES,
  DEFAULT_SKILLS,
  type DutyEntry,
  type ExecutableEntry,
  type SkillEntry,
} from "./defaults";

/**
 * Invalidate the per-repo cache for the chat defaults bundle. Wired up
 * when the write path is added in step 2.
 */
export function invalidateChatDefaultsCache(
  _owner: string,
  _repo: string,
): void {
  // No-op until the repo read is wired up.
}

export {
  DEFAULT_PERSONA_MD,
  DEFAULT_EXECUTABLE,
  DEFAULT_DUTIES,
  DEFAULT_SKILLS,
};

export type { DutyEntry, ExecutableEntry, SkillEntry };
