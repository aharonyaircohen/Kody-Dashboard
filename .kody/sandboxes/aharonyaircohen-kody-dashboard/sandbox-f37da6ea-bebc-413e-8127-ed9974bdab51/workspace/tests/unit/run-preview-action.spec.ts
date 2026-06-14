/**
 * Integration tests for the chat → preview_act dispatcher
 * (src/dashboard/lib/picker/run-preview-action.ts).
 *
 * This is the glue the user's bug reports kept landing on: the server
 * tool returns a PreviewActDirective, the client must run the action via
 * the inspector extension AND push the post-action DOM snapshot back to
 * the model as a HIDDEN follow-up so the model can chain steps without
 * acting blind (the "URL shows /register but content is landing" loop).
 *
 * We mock the picker.act and chat sendText with spies and assert the
 * orchestrator:
 *   - Translates each op shape correctly into a PreviewAction.
 *   - Bails with a useful error when the directive is malformed.
 *   - Bails with a useful error when the inspector extension is missing.
 *   - Sends a HIDDEN follow-up that carries the post-action snapshot —
 *     proving the model receives the new DOM.
 *   - Honors the per-prompt chain-depth cap so a runaway model can't
 *     loop indefinitely on `preview_act`.
 */
import { describe, it, expect, vi } from "vitest";
import {
  runPreviewAction,
  directiveToAction,
  type RunPreviewActionDeps,
} from "@dashboard/lib/picker/run-preview-action";
import type { PreviewActDirective } from "@dashboard/lib/chat-ui-actions";
import type {
  PreviewAction,
  PreviewActResult,
} from "@dashboard/lib/picker/protocol";

const directive = (
  partial: Partial<PreviewActDirective> & { op: PreviewActDirective["op"] },
): PreviewActDirective => ({
  action: "preview_act",
  reason: "test",
  ...partial,
});

function makeDeps(
  overrides: Partial<RunPreviewActionDeps> = {},
  pickerAvailable: boolean = true,
  actResult: PreviewActResult = {
    ok: true,
    info: {
      url: "https://x/register",
      title: "register",
      selection: "",
      dom: "<h1>register</h1>\n<button>Sign up</button>",
    },
  },
): RunPreviewActionDeps & {
  spies: {
    act: ReturnType<typeof vi.fn>;
    sendText: ReturnType<typeof vi.fn>;
    toastSuccess: ReturnType<typeof vi.fn>;
    toastError: ReturnType<typeof vi.fn>;
  };
  chainDepth: { value: number };
} {
  const chainDepth = { value: 0 };
  const act = vi.fn<(a: PreviewAction) => Promise<PreviewActResult>>(
    async () => actResult,
  );
  const sendText = vi.fn(async () => null);
  const toastSuccess = vi.fn();
  const toastError = vi.fn();
  return {
    pickerAvailable: () => pickerAvailable,
    act,
    sendText,
    toastSuccess,
    toastError,
    getChainDepth: () => chainDepth.value,
    incrementChainDepth: () => {
      chainDepth.value += 1;
    },
    maxAutoActions: 8,
    spies: { act, sendText, toastSuccess, toastError },
    chainDepth,
    ...overrides,
  };
}

describe("directiveToAction", () => {
  it("translates click", () => {
    expect(
      directiveToAction(directive({ op: "click", selector: "#btn" })),
    ).toEqual({ op: "click", selector: "#btn" });
  });
  it("translates fill with default empty value", () => {
    expect(
      directiveToAction(directive({ op: "fill", selector: "#email" })),
    ).toEqual({ op: "fill", selector: "#email", value: "" });
  });
  it("translates fill with explicit value", () => {
    expect(
      directiveToAction(
        directive({ op: "fill", selector: "#email", value: "a@b.com" }),
      ),
    ).toEqual({ op: "fill", selector: "#email", value: "a@b.com" });
  });
  it("translates navigate", () => {
    expect(
      directiveToAction(directive({ op: "navigate", url: "/register" })),
    ).toEqual({ op: "navigate", url: "/register" });
  });
  it("translates scroll with dy and with selector", () => {
    expect(directiveToAction(directive({ op: "scroll", dy: 100 }))).toEqual({
      op: "scroll",
      selector: undefined,
      dy: 100,
    });
    expect(
      directiveToAction(directive({ op: "scroll", selector: "#footer" })),
    ).toEqual({ op: "scroll", selector: "#footer", dy: undefined });
  });
  it("translates wait with explicit ms or default", () => {
    expect(directiveToAction(directive({ op: "wait", ms: 500 }))).toEqual({
      op: "wait",
      ms: 500,
    });
    expect(directiveToAction(directive({ op: "wait" }))).toEqual({
      op: "wait",
      ms: 200,
    });
  });
  it("returns null for missing required fields", () => {
    expect(directiveToAction(directive({ op: "click" }))).toBeNull();
    expect(directiveToAction(directive({ op: "fill" }))).toBeNull();
    expect(directiveToAction(directive({ op: "navigate" }))).toBeNull();
  });
});

describe("runPreviewAction — chat → action → hidden follow-up", () => {
  it("sends a HIDDEN follow-up carrying the post-action DOM (the user-blind-model bug)", async () => {
    const deps = makeDeps();
    await runPreviewAction(
      directive({ op: "click", selector: "#start", reason: "logging you in" }),
      deps,
    );
    // The picker was invoked with the translated action.
    expect(deps.spies.act).toHaveBeenCalledWith({
      op: "click",
      selector: "#start",
    });
    // A follow-up was sent — hidden so it doesn't appear in the UI.
    expect(deps.spies.sendText).toHaveBeenCalledTimes(1);
    const [content, _atts, opts] = deps.spies.sendText.mock.calls[0]!;
    expect(opts).toEqual({ hidden: true });
    // The follow-up carries the action label AND the post-action DOM,
    // which is the exact piece the model needs to chain steps.
    expect(content).toContain("[preview action ✅]");
    expect(content).toContain("https://x/register");
    expect(content).toContain("Sign up");
    expect(deps.spies.toastSuccess).toHaveBeenCalledOnce();
  });

  it("surfaces failure to the user AND still feeds the result back to the model", async () => {
    const deps = makeDeps({}, true, {
      ok: false,
      error: "selector not found in any preview frame: #missing",
    });
    await runPreviewAction(
      directive({ op: "click", selector: "#missing" }),
      deps,
    );
    expect(deps.spies.toastError).toHaveBeenCalledOnce();
    // Hidden follow-up still sent — the model needs to see the error to
    // pick a better selector next turn.
    expect(deps.spies.sendText).toHaveBeenCalledOnce();
    expect(deps.spies.sendText.mock.calls[0]![0]).toContain(
      "[preview action ❌]",
    );
    expect(deps.spies.sendText.mock.calls[0]![0]).toContain("#missing");
  });

  it("aborts when the inspector extension isn't installed", async () => {
    const deps = makeDeps({}, false);
    await runPreviewAction(
      directive({ op: "click", selector: "#start" }),
      deps,
    );
    expect(deps.spies.act).not.toHaveBeenCalled();
    expect(deps.spies.sendText).not.toHaveBeenCalled();
    expect(deps.spies.toastError).toHaveBeenCalledOnce();
  });

  it("aborts on a malformed directive (e.g. click with no selector)", async () => {
    const deps = makeDeps();
    await runPreviewAction(directive({ op: "click" }), deps);
    expect(deps.spies.act).not.toHaveBeenCalled();
    expect(deps.spies.sendText).not.toHaveBeenCalled();
  });

  it("caps the chain at maxAutoActions per user prompt (runaway-loop guard)", async () => {
    const deps = makeDeps();
    // Push depth right to the limit.
    deps.chainDepth.value = 8;
    await runPreviewAction(
      directive({ op: "click", selector: "#start" }),
      deps,
    );
    expect(deps.spies.act).not.toHaveBeenCalled();
    expect(deps.spies.sendText).not.toHaveBeenCalled();
    expect(deps.spies.toastError).toHaveBeenCalledOnce();
  });

  it("increments chain depth on each dispatch so the cap actually fires", async () => {
    const deps = makeDeps();
    await runPreviewAction(directive({ op: "click", selector: "#a" }), deps);
    await runPreviewAction(directive({ op: "click", selector: "#b" }), deps);
    expect(deps.chainDepth.value).toBe(2);
    expect(deps.spies.act).toHaveBeenCalledTimes(2);
  });
});
