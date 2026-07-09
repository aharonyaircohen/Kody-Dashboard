/**
 * Settle seam (phase 1.6b, review item 11) — the per-backend
 * finish/recover behavior of the send pipeline is declared as data in
 * SETTLE_STRATEGIES / FINISH_STRATEGIES and applied via ONE pair of
 * functions. These tests pin the pure decisions and the message-list
 * operations they produce, so a branch can't silently drift back to a
 * hand-rolled catch block with different wire-visible behavior.
 *
 * @testFramework vitest
 * @domain chat-contract
 */

import { describe, expect, it, vi } from "vitest";
import {
  SETTLE_STRATEGIES,
  FINISH_STRATEGIES,
  classifyTurnFailure,
  settleDecision,
  applySettleDecision,
} from "@dashboard/lib/components/kody-chat-send";
import type { Message } from "@dashboard/lib/components/kody-chat-types";

const abortError = () => {
  const err = new Error("signal is aborted without reason");
  err.name = "AbortError";
  return err;
};

describe("classifyTurnFailure", () => {
  it("classifies AbortError (Error shape) as abort", () => {
    expect(classifyTurnFailure(abortError())).toEqual({
      kind: "abort",
      message: "signal is aborted without reason",
    });
  });

  it("classifies AbortError (DOMException shape) as abort", () => {
    const err = new DOMException("The operation was aborted.", "AbortError");
    expect(classifyTurnFailure(err).kind).toBe("abort");
  });

  it("classifies a plain Error as error with its message", () => {
    expect(classifyTurnFailure(new Error("boom"))).toEqual({
      kind: "error",
      message: "boom",
    });
  });

  it("classifies a non-Error throw as Unknown error", () => {
    expect(classifyTurnFailure("nope")).toEqual({
      kind: "error",
      message: "Unknown error",
    });
  });
});

describe("settleDecision — the per-backend recover table", () => {
  it("errors are uniform: error bubble + stop loading, on every backend", () => {
    for (const backend of [
      "brain",
      "kody-direct",
      "kody-live",
      "kody-engine",
    ] as const) {
      expect(
        settleDecision(backend, { kind: "error", message: "boom" }),
      ).toEqual({
        messageOp: "error-bubble",
        stopLoading: true,
        errorMessage: "boom",
      });
    }
  });

  it("brain abort pops the optimistic slice without touching loading", () => {
    expect(settleDecision("brain", { kind: "abort", message: "x" })).toEqual({
      messageOp: "pop-last",
      stopLoading: false,
    });
  });

  it("kody-direct abort settles the bubble in place and stops loading", () => {
    expect(
      settleDecision("kody-direct", { kind: "abort", message: "x" }),
    ).toEqual({ messageOp: "unmark-loading", stopLoading: true });
  });

  it("kody-live abort surfaces like any failure (fire-and-ack has no abort path)", () => {
    expect(
      settleDecision("kody-live", { kind: "abort", message: "x" }),
    ).toEqual({
      messageOp: "error-bubble",
      stopLoading: true,
      errorMessage: "x",
    });
  });

  it("kody-engine abort mirrors brain (pop the optimistic slice)", () => {
    expect(
      settleDecision("kody-engine", { kind: "abort", message: "x" }),
    ).toEqual({ messageOp: "pop-last", stopLoading: false });
  });

  it("the strategy tables cover every backend", () => {
    const backends = ["brain", "kody-direct", "kody-live", "kody-engine"];
    expect(Object.keys(SETTLE_STRATEGIES).sort()).toEqual([...backends].sort());
    expect(Object.keys(FINISH_STRATEGIES).sort()).toEqual([...backends].sort());
  });

  it("declares the per-backend finish behavior as data", () => {
    expect(FINISH_STRATEGIES.brain).toBe("unmark-all");
    expect(FINISH_STRATEGIES["kody-direct"]).toBe("direct-finalize");
    expect(FINISH_STRATEGIES["kody-live"]).toBe("none");
    expect(FINISH_STRATEGIES["kody-engine"]).toBe("none");
  });
});

describe("applySettleDecision — the ONE recover implementation", () => {
  const run = (
    decision: Parameters<typeof applySettleDecision>[0],
    prev: Message[],
  ) => {
    let messages = prev;
    const setLoading = vi.fn();
    applySettleDecision(decision, {
      setMessages: (updater) => {
        messages = updater(messages);
      },
      setLoading,
    });
    return { messages, setLoading };
  };

  const loadingTurn: Message[] = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "partial", isLoading: true },
  ];

  it("pop-last drops the optimistic assistant slice and leaves loading alone", () => {
    const { messages, setLoading } = run(
      { messageOp: "pop-last", stopLoading: false },
      loadingTurn,
    );
    expect(messages).toEqual([{ role: "user", content: "hi" }]);
    expect(setLoading).not.toHaveBeenCalled();
  });

  it("unmark-loading settles the in-flight bubble in place (keeps partial text)", () => {
    const { messages, setLoading } = run(
      { messageOp: "unmark-loading", stopLoading: true },
      loadingTurn,
    );
    expect(messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "partial", isLoading: false },
    ]);
    expect(setLoading).toHaveBeenCalledWith(false);
  });

  it("error-bubble replaces the loading bubble with a tagged error message", () => {
    const { messages, setLoading } = run(
      { messageOp: "error-bubble", stopLoading: true, errorMessage: "boom" },
      loadingTurn,
    );
    expect(messages).toEqual([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "Error: boom",
        isLoading: false,
        isError: true,
      },
    ]);
    expect(setLoading).toHaveBeenCalledWith(false);
  });

  it("does not create immutability violations (input array is untouched)", () => {
    const frozen = loadingTurn.map((m) => Object.freeze({ ...m }));
    const input = Object.freeze([...frozen]) as unknown as Message[];
    expect(() =>
      run(
        { messageOp: "error-bubble", stopLoading: true, errorMessage: "x" },
        input,
      ),
    ).not.toThrow();
  });
});
