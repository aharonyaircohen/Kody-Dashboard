/**
 * Tests for the pure Activity Feed fold — groups the engine's per-session
 * event lines into sessions (origin, issue/run links, lifecycle, ordered
 * expandable events). Locks in grouping, origin parsing, lifecycle
 * derivation, ordering, and the session cap.
 */
import { describe, expect, it } from "vitest";
import { buildFeedSnapshot } from "@dashboard/lib/activity/feed";
import type { EventLogEntry } from "@dashboard/lib/kody-store/event-log";

const NOW = Date.parse("2026-05-17T12:00:00Z");

function entry(over: Partial<EventLogEntry>): EventLogEntry {
  return {
    id: `${Math.random()}`,
    runId: "unknown",
    event: "chat.message",
    payload: {},
    emittedAt: new Date(NOW - 60_000).toISOString(),
    ...over,
  };
}

describe("buildFeedSnapshot", () => {
  it("groups events into one session and keeps full payload", () => {
    const snap = buildFeedSnapshot([
      entry({
        id: "live-1-a:0",
        event: "chat.ready",
        payload: {
          sessionId: "live-1-a",
          startedAt: "2026-05-17T11:00:00Z",
          runId: "999",
          runUrl: "https://github.com/o/r/actions/runs/999",
        },
        emittedAt: "2026-05-17T11:00:00Z",
      }),
      entry({
        id: "live-1-a:1",
        event: "chat.message",
        payload: { sessionId: "live-1-a", role: "user", content: "hi" },
        emittedAt: "2026-05-17T11:00:05Z",
      }),
    ]);
    expect(snap.sessions).toHaveLength(1);
    const s = snap.sessions[0];
    expect(s.sessionId).toBe("live-1-a");
    expect(s.runUrl).toBe("https://github.com/o/r/actions/runs/999");
    expect(s.startedAt).toBe("2026-05-17T11:00:00Z");
    expect(s.eventCount).toBe(2);
    // raw payload preserved for the expand/copy UI
    expect(s.events[1].payload.content).toBe("hi");
  });

  it("parses origin + issue number from the sessionId", () => {
    const { sessions } = buildFeedSnapshot([
      entry({ payload: { sessionId: "vibe-1587-xyz" } }),
      entry({ payload: { sessionId: "live-direct-123" } }),
      entry({ payload: { sessionId: "live-test-1" } }),
      entry({ payload: { sessionId: "live-abc" } }),
    ]);
    const by = Object.fromEntries(
      sessions.map((s) => [s.sessionId, s]),
    );
    expect(by["vibe-1587-xyz"].origin).toBe("vibe");
    expect(by["vibe-1587-xyz"].issueNumber).toBe(1587);
    expect(by["live-direct-123"].origin).toBe("direct");
    expect(by["live-test-1"].origin).toBe("test");
    expect(by["live-abc"].origin).toBe("live");
  });

  it("derives lifecycle + status from chat.exit", () => {
    const [s] = buildFeedSnapshot([
      entry({
        event: "chat.ready",
        payload: { sessionId: "live-x", startedAt: "2026-05-17T10:00:00Z" },
        emittedAt: "2026-05-17T10:00:00Z",
      }),
      entry({
        event: "chat.exit",
        payload: {
          sessionId: "live-x",
          reason: "idle-timeout",
          turnsCompleted: 3,
          endedAt: "2026-05-17T10:05:00Z",
        },
        emittedAt: "2026-05-17T10:05:00Z",
      }),
    ]).sessions;
    expect(s.status).toBe("exited");
    expect(s.turns).toBe(3);
    expect(s.exitReason).toBe("idle-timeout");
    expect(s.endedAt).toBe("2026-05-17T10:05:00Z");
  });

  it("marks a session running when no exit event is present", () => {
    const [s] = buildFeedSnapshot([
      entry({ payload: { sessionId: "live-live" }, event: "chat.ready" }),
    ]).sessions;
    expect(s.status).toBe("running");
  });

  it("orders sessions newest-first and events chronologically", () => {
    const { sessions } = buildFeedSnapshot([
      entry({
        payload: { sessionId: "old" },
        emittedAt: "2026-05-17T09:00:00Z",
      }),
      entry({
        payload: { sessionId: "new" },
        emittedAt: "2026-05-17T11:30:00Z",
      }),
      entry({
        payload: { sessionId: "new" },
        emittedAt: "2026-05-17T11:00:00Z",
      }),
    ]);
    expect(sessions.map((s) => s.sessionId)).toEqual(["new", "old"]);
    expect(sessions[0].events.map((e) => e.emittedAt)).toEqual([
      "2026-05-17T11:00:00Z",
      "2026-05-17T11:30:00Z",
    ]);
  });

  it("caps sessions at the limit but reports the true totals", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      entry({ payload: { sessionId: `s${i}` } }),
    );
    const snap = buildFeedSnapshot(many, NOW, 10);
    expect(snap.sessions).toHaveLength(10);
    expect(snap.totalSessions).toBe(30);
    expect(snap.totalEvents).toBe(30);
  });
});
