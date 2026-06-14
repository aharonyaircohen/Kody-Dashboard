/**
 * @fileType module
 * @domain picker
 * @pattern dependency-injected
 * @ai-summary Pure orchestrator for a chat-driven preview action. The
 *   server emits a PreviewActDirective; KodyChat detects it on the
 *   stream-close, then calls this helper with the picker and chat-send
 *   functions injected. The helper validates the directive, runs the
 *   action via the picker, and pushes a hidden follow-up turn carrying
 *   the post-action snapshot so the model can observe what changed.
 *
 *   Extracted from KodyChat.tsx so the integration glue is unit-testable
 *   in node without spinning up the whole dashboard. The Playwright tests
 *   under tests/e2e/preview-act-extension.spec.ts cover the picker side
 *   in a real browser; this module is the dashboard side.
 */
import type { PreviewActDirective } from "../chat-ui-actions";
import {
  formatPreviewActResult,
  type PreviewAction,
  type PreviewActResult,
} from "./protocol";

export interface RunPreviewActionDeps {
  /** Whether the inspector extension is reachable in this tab. */
  pickerAvailable: () => boolean;
  /** Picker's act() — runs the action in the preview frame. */
  act: (action: PreviewAction) => Promise<PreviewActResult>;
  /** Chat sendText — hidden=true skips the user-bubble render. */
  sendText: (
    content: string,
    attachments: never[],
    options: { hidden: true },
  ) => Promise<unknown>;
  /** UI toasts. Use to surface action success/failure to the user. */
  toastSuccess: (msg: string) => void;
  toastError: (msg: string) => void;
  /** Per-prompt counter — caps runaway chains. Mutates externally. */
  getChainDepth: () => number;
  incrementChainDepth: () => void;
  /** Hard ceiling on consecutive chained actions per real user prompt. */
  maxAutoActions: number;
}

/** Translate a wire-format directive into the picker's PreviewAction. */
export function directiveToAction(
  directive: PreviewActDirective,
): PreviewAction | null {
  switch (directive.op) {
    case "click":
      if (!directive.selector) return null;
      return { op: "click", selector: directive.selector };
    case "fill":
      if (!directive.selector) return null;
      return {
        op: "fill",
        selector: directive.selector,
        value: directive.value ?? "",
      };
    case "navigate":
      if (!directive.url) return null;
      return { op: "navigate", url: directive.url };
    case "scroll":
      return { op: "scroll", selector: directive.selector, dy: directive.dy };
    case "wait":
      return { op: "wait", ms: directive.ms ?? 200 };
    default:
      return null;
  }
}

/**
 * Run a preview action and push the post-action snapshot back into chat
 * as a HIDDEN user turn so the model can chain steps without polluting
 * the visible chat with synthetic bubbles. Resolves when the follow-up
 * send has been initiated (not when its server response settles).
 */
export async function runPreviewAction(
  directive: PreviewActDirective,
  deps: RunPreviewActionDeps,
): Promise<void> {
  const action = directiveToAction(directive);
  if (!action) {
    deps.toastError("Preview action: malformed directive");
    return;
  }
  if (!deps.pickerAvailable()) {
    deps.toastError(
      "Preview action failed — install the Kody Preview Inspector extension.",
    );
    return;
  }
  if (deps.getChainDepth() >= deps.maxAutoActions) {
    deps.toastError(
      `Stopped after ${deps.maxAutoActions} chained preview actions — ask me again to continue.`,
    );
    return;
  }
  deps.incrementChainDepth();
  const result = await deps.act(action);
  if (result.ok) {
    deps.toastSuccess(`Preview: ${directive.reason}`);
  } else {
    deps.toastError(
      `Preview action failed: ${result.error ?? "unknown error"}`,
    );
  }
  const followUp = formatPreviewActResult(action, result);
  await deps.sendText(followUp, [], { hidden: true });
}
