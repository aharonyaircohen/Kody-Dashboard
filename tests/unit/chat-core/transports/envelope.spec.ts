/**
 * @fileoverview Zod event-envelope specs (M5.2): corrupt wire chunks are
 * skipped exactly as the pre-adapter code skipped them, and single
 * mistyped fields degrade to "absent" instead of dropping the event.
 * @testFramework vitest
 * @domain chat-core
 */

import { describe, it, expect } from "vitest";
import {
  parseBrainWireEvent,
  parseKodyDirectChunk,
} from "@dashboard/lib/chat/core/transports/envelope";

describe("parseBrainWireEvent", () => {
  it("parses a well-formed chat.message event", () => {
    const parsed = parseBrainWireEvent(
      JSON.stringify({
        type: "chat.message",
        role: "assistant",
        content: "Hello",
        seq: 3,
      }),
    );
    expect(parsed).toMatchObject({
      type: "chat.message",
      role: "assistant",
      content: "Hello",
      seq: 3,
    });
  });

  it("returns null for malformed JSON (line is skipped, stream continues)", () => {
    expect(parseBrainWireEvent("{not json")).toBeNull();
  });

  it("returns null for non-object payloads (old code no-op'd or swallowed)", () => {
    expect(parseBrainWireEvent("42")).toBeNull();
    expect(parseBrainWireEvent('"hi"')).toBeNull();
    expect(parseBrainWireEvent("null")).toBeNull();
  });

  it("keeps the event when a single field is mistyped (field degrades to absent)", () => {
    // Pre-zod, `typeof parsed.seq === "number"` guarded per field — a
    // string seq was ignored but the rest of the event still applied.
    const parsed = parseBrainWireEvent(
      JSON.stringify({ type: "chat.message", content: "ok", seq: "9" }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("chat.message");
    expect(parsed?.content).toBe("ok");
    expect(parsed?.seq).toBeUndefined();
  });

  it("keeps chat.tool_use input only when it is an object", () => {
    const good = parseBrainWireEvent(
      JSON.stringify({
        type: "chat.tool_use",
        name: "search",
        input: { q: 1 },
      }),
    );
    expect(good?.input).toEqual({ q: 1 });
    const bad = parseBrainWireEvent(
      JSON.stringify({ type: "chat.tool_use", name: "search", input: "boom" }),
    );
    expect(bad?.name).toBe("search");
    expect(bad?.input).toBeUndefined();
  });
});

describe("parseKodyDirectChunk", () => {
  it("parses a text-delta chunk", () => {
    expect(
      parseKodyDirectChunk(JSON.stringify({ type: "text-delta", delta: "a" })),
    ).toMatchObject({ type: "text-delta", delta: "a" });
  });

  it("returns null for malformed JSON (chunk is skipped, stream continues)", () => {
    expect(parseKodyDirectChunk("{oops")).toBeNull();
  });

  it("returns null for non-object payloads", () => {
    expect(parseKodyDirectChunk("7")).toBeNull();
    expect(parseKodyDirectChunk("null")).toBeNull();
  });

  it("passes unknown chunk types through (adapter no-ops them)", () => {
    const parsed = parseKodyDirectChunk(
      JSON.stringify({ type: "start-step", weird: true }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("start-step");
  });

  it("keeps a tool-output-available chunk whose output is null", () => {
    // JSON null output must survive (`"output" in chunk` was true before).
    const parsed = parseKodyDirectChunk(
      JSON.stringify({
        type: "tool-output-available",
        toolCallId: "t1",
        output: null,
      }),
    );
    expect(parsed?.toolCallId).toBe("t1");
    expect("output" in (parsed ?? {})).toBe(true);
    expect(parsed?.output).toBeNull();
  });

  it("degrades a mistyped field without dropping the chunk", () => {
    const parsed = parseKodyDirectChunk(
      JSON.stringify({ type: "text-delta", delta: 5 }),
    );
    expect(parsed?.type).toBe("text-delta");
    expect(parsed?.delta).toBeUndefined();
  });
});
