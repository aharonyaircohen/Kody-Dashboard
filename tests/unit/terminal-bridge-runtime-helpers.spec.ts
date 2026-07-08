/**
 * @fileoverview Unit coverage for terminal bridge runtime helpers.
 * @testFramework vitest
 * @domain terminal
 */
import { describe, expect, it } from "vitest";

import {
  normalizeTerminalSize,
  restoreCompleteMessage,
  restoreStartMessage,
  stripTerminalMouseInput,
} from "@dashboard/lib/terminal/bridge-runtime";

describe("terminal bridge runtime helpers", () => {
  it("normalizes terminal sizes to bounded integers", () => {
    expect(normalizeTerminalSize(120.9, 44.2)).toEqual({ cols: 120, rows: 44 });
    expect(normalizeTerminalSize(0, 2000)).toEqual({ cols: 1, rows: 1000 });
    expect(normalizeTerminalSize("bad", 24)).toBeNull();
  });

  it("removes browser mouse packets before terminal stdin", () => {
    expect(stripTerminalMouseInput("\x1b[<0;12;5Mhello\x1b[<0;12;5m")).toBe(
      "hello",
    );
    expect(stripTerminalMouseInput("\x1b[M !!typed")).toBe("typed");
  });

  it("creates typed restore lifecycle messages", () => {
    expect(restoreStartMessage("hello")).toEqual({
      type: "restore-start",
      replayBytes: 5,
    });
    expect(restoreCompleteMessage()).toEqual({ type: "restore-complete" });
  });
});
