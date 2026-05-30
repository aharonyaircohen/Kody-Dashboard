/**
 * @fileType module
 * @domain preview
 * @pattern repo-scoped-localStorage
 * @ai-summary Named, replayable macros: user-recorded sequences of
 *   preview actions (click / fill) the extension captured. Replaces the
 *   old "record → generate Playwright test code" flow; now each macro is
 *   stored as a list of PreviewAction steps that can be replayed through
 *   the inspector extension OR sent to chat for the model to drive.
 *
 *   Per-repo localStorage so different projects keep their own macros.
 */

import type { RecordedStep } from "./picker/protocol";
import type { PreviewAction } from "./picker/protocol";

export interface Macro {
  /** Stable id for React keys + selection state. */
  id: string;
  /** User-supplied label. Short — fits in the dropdown row. */
  name: string;
  /** Unix ms — used to sort newest first and dedupe replay logs. */
  createdAt: number;
  /** Replayable steps. Same shape preview_act uses on the wire. */
  steps: PreviewAction[];
}

const STORAGE_PREFIX = "kody.macros";

function storageKey(owner: string, repo: string): string {
  return `${STORAGE_PREFIX}.${owner}/${repo}`;
}

/**
 * Map a recorder-captured RecordedStep to a replayable PreviewAction.
 * The two shapes are nearly identical (one is what the user did, the
 * other is what we re-issue) but the recorder lacks ms / dy / wait
 * fields so we keep this translation explicit.
 */
export function recordedStepToAction(
  step: RecordedStep,
): PreviewAction | null {
  if (step.type === "click") {
    if (!step.selector) return null;
    return { op: "click", selector: step.selector };
  }
  if (step.type === "fill") {
    if (!step.selector) return null;
    return { op: "fill", selector: step.selector, value: step.value ?? "" };
  }
  return null;
}

/** Read the stored macros (newest first). SSR-safe. */
export function readMacros(owner: string, repo: string): Macro[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(owner, repo));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const safe = parsed.filter(
      (m): m is Macro =>
        m &&
        typeof m === "object" &&
        typeof m.id === "string" &&
        typeof m.name === "string" &&
        typeof m.createdAt === "number" &&
        Array.isArray(m.steps),
    );
    return safe.slice().sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/** Write the list back to storage. No-ops in SSR / private mode. */
export function writeMacros(
  owner: string,
  repo: string,
  macros: Macro[],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKey(owner, repo),
      JSON.stringify(macros),
    );
  } catch {
    /* quota — drop silently */
  }
}

/** Append a new macro; ignores empty names or zero-step recordings. */
export function addMacro(
  macros: Macro[],
  name: string,
  steps: PreviewAction[],
  now: number,
): Macro[] {
  const trimmedName = name.trim().slice(0, 64);
  if (!trimmedName || steps.length === 0) return macros;
  const id = `${trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  return [
    { id, name: trimmedName, createdAt: now, steps },
    ...macros,
  ];
}

export function removeMacro(macros: Macro[], id: string): Macro[] {
  return macros.filter((m) => m.id !== id);
}

/**
 * Render a macro as a chat-ready instruction block. The model reads this
 * and calls preview_act once per step — same dispatch path as a manual
 * "click X then fill Y" request, just typed up for it.
 */
export function formatMacroForChat(macro: Macro): string {
  const lines: string[] = [
    `Please run this saved preview macro by calling preview_act for each step in order. Stop and report if any step fails — don't skip ahead.`,
    `Macro: ${macro.name} (${macro.steps.length} step${macro.steps.length === 1 ? "" : "s"})`,
    "",
  ];
  macro.steps.forEach((step, i) => {
    const n = i + 1;
    switch (step.op) {
      case "click":
        lines.push(`${n}. click \`${step.selector}\``);
        break;
      case "fill":
        lines.push(
          `${n}. fill \`${step.selector}\` with \`${step.value}\``,
        );
        break;
      case "navigate":
        lines.push(`${n}. navigate to \`${step.url}\``);
        break;
      case "scroll":
        lines.push(
          step.selector
            ? `${n}. scroll to \`${step.selector}\``
            : `${n}. scroll by ${step.dy ?? 0}px`,
        );
        break;
      case "wait":
        lines.push(`${n}. wait ${step.ms}ms`);
        break;
    }
  });
  return lines.join("\n");
}
