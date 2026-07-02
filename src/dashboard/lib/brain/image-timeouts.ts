/**
 * @fileType utility
 * @domain brain
 * @pattern brain-image-timeouts
 *
 * @ai-summary Shared timeout and output-size policy for the Brain image
 *   save/restore shell jobs. Default is 2 hours, clamped to
 *   `[5 min, 2 h]`, and overridable per-deployment via
 *   `KODY_BRAIN_IMAGE_JOB_TIMEOUT_MS`. Trap: save and restore must import
 *   from here — they MUST use the same `brainImageJobTimeoutMs()` value,
 *   because the Runner page uses it as the upper bound on its progress bar
 *   promise. If one side hard-codes a smaller timeout the UI's "still
 *   working" indicator will lie when the longer side is actually still
 *   running. Same constants here for both directions on purpose.
 */

export const DEFAULT_BRAIN_IMAGE_JOB_TIMEOUT_MS = 2 * 60 * 60_000;
export const BRAIN_IMAGE_JOB_OUTPUT_BYTES = 8 * 1024 * 1024;

const MIN_BRAIN_IMAGE_JOB_TIMEOUT_MS = 5 * 60_000;
const MAX_BRAIN_IMAGE_JOB_TIMEOUT_MS = 2 * 60 * 60_000;

export function brainImageJobTimeoutMs(
  raw = process.env.KODY_BRAIN_IMAGE_JOB_TIMEOUT_MS,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_BRAIN_IMAGE_JOB_TIMEOUT_MS;
  }
  return Math.min(
    MAX_BRAIN_IMAGE_JOB_TIMEOUT_MS,
    Math.max(MIN_BRAIN_IMAGE_JOB_TIMEOUT_MS, Math.trunc(parsed)),
  );
}
