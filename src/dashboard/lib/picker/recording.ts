import type { RecordedStep } from "./protocol";

export interface RecordingResult {
  steps: RecordedStep[];
  url: string;
}

export function pickRecordingResult(
  current: RecordingResult | null,
  next: RecordingResult,
): RecordingResult {
  if (!current) return next;
  if (next.steps.length > current.steps.length) return next;
  if (current.steps.length === 0 && !current.url && next.url) return next;
  return current;
}

export function hasRecordedSteps(
  result: RecordingResult | null,
): result is RecordingResult {
  return !!result && result.steps.length > 0;
}
