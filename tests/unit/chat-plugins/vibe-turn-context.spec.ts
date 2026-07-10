/**
 * @fileoverview Pins the vibe request-body wire shape extracted in Step 5c
 *   (chat/plugins/vibe/turn-context.ts). Before the move this shaping was
 *   inlined four times in KodyChat's sendText; these tests pin the exact
 *   spread output so the extraction stays byte-identical: no keys outside
 *   vibe mode, `vibeMode: true` in it, and `taskContext` only when a task
 *   scope resolves (with `prNumber`/`branch` only when a PR is linked).
 * @testFramework vitest
 * @domain chat-plugins
 */

import { describe, expect, it } from "vitest";
import {
  vibeLiveTaskContext,
  vibeTurnFields,
} from "@kody-chat/chat/plugins/vibe/turn-context";

describe("vibeLiveTaskContext", () => {
  const task = {
    issueNumber: 42,
    associatedPR: { number: 101, head: { ref: "42-header" } },
  };

  it("is undefined outside vibe mode, even with a task", () => {
    expect(vibeLiveTaskContext(false, task)).toBeUndefined();
    expect(vibeLiveTaskContext(undefined, task)).toBeUndefined();
  });

  it("is undefined in vibe mode without a task scope", () => {
    expect(vibeLiveTaskContext(true, null)).toBeUndefined();
    expect(vibeLiveTaskContext(true, undefined)).toBeUndefined();
  });

  it("carries issueNumber + prNumber + branch when a PR is linked", () => {
    expect(vibeLiveTaskContext(true, task)).toEqual({
      issueNumber: 42,
      prNumber: 101,
      branch: "42-header",
    });
  });

  it("omits prNumber/branch keys entirely when no PR is linked", () => {
    const out = vibeLiveTaskContext(true, { issueNumber: 7 });
    expect(out).toEqual({ issueNumber: 7 });
    expect(Object.keys(out ?? {})).toEqual(["issueNumber"]);
  });

  it("omits prNumber/branch when associatedPR is explicitly null", () => {
    expect(vibeLiveTaskContext(true, { issueNumber: 7, associatedPR: null }))
      .toEqual({ issueNumber: 7 });
  });
});

describe("vibeTurnFields", () => {
  it("adds NO keys outside vibe mode (request bodies stay untouched)", () => {
    expect(vibeTurnFields(false)).toEqual({});
    expect(Object.keys(vibeTurnFields(undefined))).toEqual([]);
    // A stray taskContext must not leak through either.
    expect(
      vibeTurnFields(false, { issueNumber: 42 }),
    ).toEqual({});
  });

  it("adds only vibeMode when no task context resolves", () => {
    const out = vibeTurnFields(true);
    expect(out).toEqual({ vibeMode: true });
    expect(Object.keys(out)).toEqual(["vibeMode"]);
  });

  it("adds vibeMode + taskContext when a context is provided", () => {
    expect(
      vibeTurnFields(true, { issueNumber: 42, prNumber: 101, branch: "42-h" }),
    ).toEqual({
      vibeMode: true,
      taskContext: { issueNumber: 42, prNumber: 101, branch: "42-h" },
    });
  });

  it("composes with vibeLiveTaskContext exactly like the old inline spreads", () => {
    // Old shape: ...(vibeMode ? { vibeMode: true } : {}),
    //            ...(vibeMode && task ? { taskContext: {...} } : {})
    const body = {
      taskId: "s-1",
      ...vibeTurnFields(true, vibeLiveTaskContext(true, { issueNumber: 7 })),
    };
    expect(body).toEqual({
      taskId: "s-1",
      vibeMode: true,
      taskContext: { issueNumber: 7 },
    });
  });
});
