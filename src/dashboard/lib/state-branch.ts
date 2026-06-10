/**
 * @fileType util
 * @domain kody
 * @ai-summary Name of the dedicated branch the engine commits machine-written
 *   state to (per-job `.state.json` cursors and generated reports). Kept off
 *   the default branch so high-churn `chore(jobs): …` / `chore(reports): …`
 *   commits don't bury real code. The dashboard reads these files from this
 *   branch; human-authored config (`.md`, prompts, profile, variables,
 *   secrets) still lives on the default branch. Must match `STATE_BRANCH` in
 *   the kody2 engine (`src/stateBranch.ts`).
 */

export const STATE_BRANCH = "kody-state";
