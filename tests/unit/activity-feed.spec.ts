/**
 * Tests for the pure Activity Feed fold — normalizes the engine's
 * append-only event log into the on-demand Feed view. Locks in source
 * bucketing, summary derivation, newest-first ordering, and the render cap.
 */
import { describe, expect, it } from "vitest";
import { buildFeedSnapshot } from "@dashboard/lib/activity/feed";
import type { EventLogEntry } from "@dashboard/lib/kody-store/event-log";

const NOW = Date.parse("2026-05-17T12:00:00Z");

function entry(over: Partial<EventLogEntry>): EventLogEntry {
  return {
    id: `${Math.random()}`,
    runId: "unknown",
    event: "step.start",
    payload: {},
    emittedAt: new Date(NOW - 60_000).toISOString(),
    ...over,
  };
}

describe("buildFeedSnapshot", () => {
  it("buckets source from channel and event name", () => {
    const { events } = buildFeedSnapshot([
      entry({ event: "chat.message", channel: undefined }),
      entry({ event: "step.end", channel: "engine" }),
      entry({ event: "deploy", channel: "pipeline" }),
      entry({ event: "random.thing", channel: undefined }),
    ]);
    const byKind = Object.fromEntries(events.map((e) => [e.kind, e.source]));
    expect(byKind["chat.message"]).toBe("chat");
    expect(byKind["step.end"]).toBe("engine");
    expect(byKind["deploy"]).toBe("pipeline");
    expect(byKind["random.thing"]).toBe("other");
  });

  it("sorts newest first", () => {
    const { events } = buildFeedSnapshot([
      entry({ event: "old", emittedAt: new Date(NOW - 9_000).toISOString() }),
      entry({ event: "new", emittedAt: new Date(NOW - 1_000).toISOString() }),
    ]);
    expect(events.map((e) => e.kind)).toEqual(["new", "old"]);
  });

  it("derives a summary from payload text + action state", () => {
    const [ev] = buildFeedSnapshot([
      entry({
        event: "step.start",
        payload: { message: "running tests" },
        actionState: { status: "in_progress", step: "verify" },
      }),
    ]).events;
    expect(ev.summary).toContain("verify");
    expect(ev.summary).toContain("in_progress");
    expect(ev.summary).toContain("running tests");
  });

  it("nulls the placeholder runId and surfaces a real one", () => {
    const { events } = buildFeedSnapshot([
      entry({ runId: "unknown" }),
      entry({ runId: "42" }),
    ]);
    expect(events.some((e) => e.runId === null)).toBe(true);
    expect(events.some((e) => e.runId === "42")).toBe(true);
  });

  it("caps rendered events at the limit but reports the true total", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      entry({ event: `e${i}` }),
    );
    const snap = buildFeedSnapshot(many, NOW, 10);
    expect(snap.events).toHaveLength(10);
    expect(snap.total).toBe(30);
  });
});
