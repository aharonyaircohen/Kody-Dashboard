/**
 * @fileType utility
 * @domain kody
 * @pattern activity-feed
 * @ai-summary Pure: fold the engine's per-session event lines
 *   (`.kody/events/*.jsonl`, read via `readFeedEntries`) into the Activity
 *   Feed. The unit is a *session* (a chat or run), not a raw event line —
 *   each session carries origin, issue/run links, initiator, lifecycle
 *   times and an ordered, fully-expandable event list (raw payload kept,
 *   not discarded). No I/O — pure so it's unit-testable and reusable.
 */
import type { EventLogEntry } from "../kody-store/event-log";

/** Coarse bucket for a single event, derived from channel + event name. */
export type FeedSource = "engine" | "chat" | "pipeline" | "other";

/** Where the session came from — read off the sessionId prefix. */
export type FeedOrigin = "live" | "vibe" | "direct" | "test" | "other";

export type FeedStatus = "running" | "exited" | "error" | "unknown";

export interface FeedEvent {
  id: string;
  /** Exact ISO emit time (rendered precisely, not just relative). */
  emittedAt: string;
  /** Raw event name from the log (e.g. "chat.message", "step.start"). */
  kind: string;
  source: FeedSource;
  /** One-line human summary; the full data is in `payload`. */
  summary: string;
  /** Untouched payload so the row can expand to the raw record. */
  payload: Record<string, unknown>;
  runId: string | null;
  channel: string | null;
  status: string | null;
  step: string | null;
}

export interface FeedSession {
  sessionId: string;
  origin: FeedOrigin;
  /** Issue number for vibe sessions (`vibe-1587-…`), else null. */
  issueNumber: number | null;
  runId: string | null;
  /** Deep-link to the GitHub Actions run, from the chat.ready event. */
  runUrl: string | null;
  startedAt: string | null;
  endedAt: string | null;
  /** Newest event time — what the list sorts/displays on. */
  lastEventAt: string;
  /** Initiator: the role/login that opened the session, if discernible. */
  initiator: string | null;
  turns: number | null;
  exitReason: string | null;
  status: FeedStatus;
  eventCount: number;
  /** Chronological (oldest → newest) for drill-down. */
  events: FeedEvent[];
}

export interface FeedSnapshot {
  /** Newest session first. */
  sessions: FeedSession[];
  totalSessions: number;
  totalEvents: number;
  /** ISO time the snapshot was computed (server clock). */
  computedAt: string;
}

const CHAT_HINTS = ["chat", "message", "session", "prompt", "tool", "llm"];

function deriveSource(channel: string | undefined, event: string): FeedSource {
  const c = (channel ?? "").toLowerCase();
  const e = event.toLowerCase();
  if (
    c === "chat" ||
    CHAT_HINTS.some((h) => e.startsWith(h) || e.includes(`.${h}`))
  )
    return "chat";
  if (c === "pipeline") return "pipeline";
  if (c === "engine" || e.startsWith("step.") || e.startsWith("run."))
    return "engine";
  return "other";
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function truncate(s: string, max = 200): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function summarize(entry: EventLogEntry): string {
  const p = entry.payload;
  // Chat turns: the role + content is the whole point of the line.
  if (entry.event === "chat.message") {
    const role = str(p.role) ?? "msg";
    const content = str(p.content) ?? "";
    return truncate(`${role}: ${content}`);
  }
  if (entry.event === "chat.exit") {
    const reason = str(p.reason) ?? "ended";
    const turns = num(p.turnsCompleted);
    return truncate(
      `exit · ${reason}${turns != null ? ` · ${turns} turn(s)` : ""}`,
    );
  }
  const text =
    str(p.message) ??
    str(p.summary) ??
    str(p.title) ??
    str(p.text) ??
    str(p.error) ??
    str(p.detail);
  const status = entry.actionState?.status;
  const step = entry.actionState?.step;
  const head = step ? `${entry.event} · ${step}` : entry.event;
  const parts = [head];
  if (status) parts.push(`(${status})`);
  if (text) parts.push(`— ${text}`);
  return truncate(parts.join(" "));
}

function deriveOrigin(sessionId: string): {
  origin: FeedOrigin;
  issueNumber: number | null;
} {
  const vibe = sessionId.match(/^vibe-(\d+)-/);
  if (vibe) return { origin: "vibe", issueNumber: Number(vibe[1]) };
  if (sessionId.startsWith("live-direct-"))
    return { origin: "direct", issueNumber: null };
  if (sessionId.startsWith("live-test-"))
    return { origin: "test", issueNumber: null };
  if (sessionId.startsWith("live-"))
    return { origin: "live", issueNumber: null };
  return { origin: "other", issueNumber: null };
}

function toEvent(e: EventLogEntry): FeedEvent {
  return {
    id: e.id,
    emittedAt: e.emittedAt,
    kind: e.event,
    source: deriveSource(e.channel, e.event),
    summary: summarize(e),
    payload: e.payload ?? {},
    runId: e.runId && e.runId !== "unknown" ? e.runId : null,
    channel: e.channel ?? null,
    status: e.actionState?.status ?? null,
    step: e.actionState?.step ?? null,
  };
}

function sessionIdOf(e: EventLogEntry): string {
  const fromState = e.actionState?.sessionId;
  if (fromState) return fromState;
  const fromPayload = e.payload?.sessionId;
  if (typeof fromPayload === "string" && fromPayload) return fromPayload;
  // feed-source ids events as `${sessionId}:${idx}` — recover the prefix.
  const colon = e.id.lastIndexOf(":");
  return colon > 0 ? e.id.slice(0, colon) : e.id;
}

function buildSession(
  sessionId: string,
  entries: EventLogEntry[],
): FeedSession {
  const chrono = [...entries].sort(
    (a, b) =>
      new Date(a.emittedAt).getTime() - new Date(b.emittedAt).getTime(),
  );
  const events = chrono.map(toEvent);
  const { origin, issueNumber } = deriveOrigin(sessionId);

  const ready = chrono.find((e) => e.event === "chat.ready")?.payload ?? {};
  const exit = chrono.find((e) => e.event === "chat.exit")?.payload;
  const firstUserMsg = chrono.find(
    (e) => e.event === "chat.message" && str(e.payload.role) === "user",
  )?.payload;

  const startedAt =
    str(ready.startedAt) ?? chrono[0]?.emittedAt ?? null;
  const endedAt = exit ? (str(exit.endedAt) ?? null) : null;
  const lastEventAt =
    chrono[chrono.length - 1]?.emittedAt ?? startedAt ?? "";

  return {
    sessionId,
    origin,
    issueNumber,
    runId: str(ready.runId),
    runUrl: str(ready.runUrl),
    startedAt,
    endedAt,
    lastEventAt,
    initiator:
      str(firstUserMsg?.author) ??
      str(firstUserMsg?.login) ??
      (firstUserMsg ? "user" : null),
    turns: exit ? num(exit.turnsCompleted) : null,
    exitReason: exit ? str(exit.reason) : null,
    status: exit
      ? str(exit.reason)?.includes("error")
        ? "error"
        : "exited"
      : chrono.length > 0
        ? "running"
        : "unknown",
    eventCount: events.length,
    events,
  };
}

/**
 * Group raw event entries into sessions, newest session first. `limit`
 * caps the number of sessions returned (default 50) so a busy repo
 * doesn't ship an unbounded payload.
 */
export function buildFeedSnapshot(
  entries: EventLogEntry[],
  now: number = Date.now(),
  limit = 50,
): FeedSnapshot {
  const bySession = new Map<string, EventLogEntry[]>();
  for (const e of entries) {
    const sid = sessionIdOf(e);
    const list = bySession.get(sid);
    if (list) list.push(e);
    else bySession.set(sid, [e]);
  }

  const sessions = [...bySession.entries()]
    .map(([sid, list]) => buildSession(sid, list))
    .sort(
      (a, b) =>
        new Date(b.lastEventAt).getTime() -
        new Date(a.lastEventAt).getTime(),
    );

  return {
    sessions: sessions.slice(0, limit),
    totalSessions: sessions.length,
    totalEvents: entries.length,
    computedAt: new Date(now).toISOString(),
  };
}
