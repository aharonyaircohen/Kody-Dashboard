/**
 * @fileoverview Unit tests for the chat platform client trace ring buffer:
 * capacity eviction, ordering, monotonic sequence numbers, immutable
 * snapshots, clear, and never-throw guarantees of the module singleton.
 *
 * @testFramework vitest
 * @domain chat-platform
 */
import { describe, expect, it } from "vitest";

import {
  CHAT_TRACE_CAPACITY,
  createChatTraceBuffer,
  readChatTrace,
  trace,
} from "@dashboard/lib/chat/platform/trace";

describe("chat trace ring buffer", () => {
  it("records events oldest → newest with monotonic seq", () => {
    const buffer = createChatTraceBuffer(10);
    buffer.trace({ kind: "a" });
    buffer.trace({ kind: "b", detail: { x: 1 } });
    const entries = buffer.read();
    expect(entries.map((e) => e.kind)).toEqual(["a", "b"]);
    expect(entries[1].detail).toEqual({ x: 1 });
    expect(entries[0].detail).toBeUndefined();
    expect(entries[1].seq).toBeGreaterThan(entries[0].seq);
    for (const e of entries) expect(typeof e.at).toBe("number");
  });

  it("evicts oldest entries past capacity, keeping seq monotonic", () => {
    const buffer = createChatTraceBuffer(3);
    for (let i = 0; i < 7; i++) buffer.trace({ kind: `k${i}` });
    const entries = buffer.read();
    expect(entries.map((e) => e.kind)).toEqual(["k4", "k5", "k6"]);
    expect(entries.map((e) => e.seq)).toEqual([4, 5, 6]);
  });

  it("read() returns fresh copies (no mutation leaks into the buffer)", () => {
    const buffer = createChatTraceBuffer(5);
    buffer.trace({ kind: "a" });
    const first = buffer.read();
    first[0].kind = "tampered";
    first.push({ kind: "extra", seq: 99, at: 0 });
    expect(buffer.read().map((e) => e.kind)).toEqual(["a"]);
  });

  it("clear() empties the buffer but keeps seq advancing", () => {
    const buffer = createChatTraceBuffer(5);
    buffer.trace({ kind: "a" });
    buffer.clear();
    expect(buffer.read()).toEqual([]);
    buffer.trace({ kind: "b" });
    expect(buffer.read()[0].seq).toBe(1);
  });

  it("defaults to the documented capacity", () => {
    const buffer = createChatTraceBuffer();
    for (let i = 0; i < CHAT_TRACE_CAPACITY + 20; i++) {
      buffer.trace({ kind: "x" });
    }
    expect(buffer.read()).toHaveLength(CHAT_TRACE_CAPACITY);
    expect(CHAT_TRACE_CAPACITY).toBe(200);
  });

  it("module singleton trace()/readChatTrace() work without a window", () => {
    // Node test env has no window — the guarded exposure must not throw
    // at import time and the singleton must still record.
    expect(() => trace({ kind: "singleton-check" })).not.toThrow();
    const kinds = readChatTrace().map((e) => e.kind);
    expect(kinds).toContain("singleton-check");
  });
});
