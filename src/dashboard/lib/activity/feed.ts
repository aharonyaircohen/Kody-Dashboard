/**
 * @fileType utility
 * @domain kody
 * @pattern activity-feed
 * @ai-summary Pure: fold the engine's append-only event log
 *   (`.kody/event-log.jsonl`, read via `getAllEvents`) into a normalized,
 *   source-agnostic Feed the Activity page renders on demand. No I/O — the
 *   route fetches via the cached `readEventLogCached` and hands the array
 *   here. Pure so it's unit-testable and reusable.
 */
import type { EventLogEntry } from "../kody-store/event-log";

/** Coarse bucket for filtering/coloring, derived from channel + event name. */
export type FeedSource = "engine" | "chat" | "pipeline" | "other";

export interface FeedEvent {
  id: string;
  emittedAt: string;
  /** Raw event name from the log (e.g. "step.start", "chat.message"). */
  kind: string;
  source: FeedSource;
  /** One-line human summary, best-effort from the payload. */
  summary: string;
  runId: string | null;
  sessionId: string | null;
  channel: string | null;
  /** Engine action-lifecycle status if the entry carried one. */
  status: string | null;
  step: string | null;
}

export interface FeedSnapshot {
  /** Newest first. */
  events: FeedEvent[];
  total: number;
  /** ISO time the snapshot was computed (server clock). */
  computedAt: string;
}

const CHAT_HINTS = ["chat", "message", "session", "prompt", "tool", "llm"];

function deriveSource(channel: string | undefined, event: string): FeedSource {
  const c = (channel ?? "").toLowerCase();
  const e = event.toLowerCase();
  if (c === "chat" || CHAT_HINTS.some((h) => e.startsWith(h) || e.includes(`.${h}`)))
    return "chat";
  if (c === "pipeline") return "pipeline";
  if (c === "engine" || e.startsWith("step.") || e.startsWith("run."))
    return "engine";
  return "other";
}

/** First non-empty string field from a small allow-list of common keys. */
function pickText(payload: Record<string, unknown>): string | null {
  for (const k of [
    "message",
    "summary",
    "title",
    "text",
    "name",
    "tool",
    "error",
    "detail",
  ]) {
    const v = payload[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function truncate(s: string, max = 160): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function summarize(entry: EventLogEntry): string {
  const text = pickText(entry.payload);
  const status = entry.actionState?.status;
  const step = entry.actionState?.step;
  const head = step ? `${entry.event} · ${step}` : entry.event;
  const parts = [head];
  if (status) parts.push(`(${status})`);
  if (text) parts.push(`— ${text}`);
  return truncate(parts.join(" "));
}

/**
 * Normalize raw event-log entries into the Feed view model.
 * Sorted newest-first; `limit` caps the rendered list (default 500) so a
 * 10k-line log doesn't ship a megabyte of JSON to the client.
 */
export function buildFeedSnapshot(
  entries: EventLogEntry[],
  now: number = Date.now(),
  limit = 500,
): FeedSnapshot {
  const events: FeedEvent[] = entries
    .map((e) => ({
      id: e.id,
      emittedAt: e.emittedAt,
      kind: e.event,
      source: deriveSource(e.channel, e.event),
      summary: summarize(e),
      runId: e.runId && e.runId !== "unknown" ? e.runId : null,
      sessionId: e.actionState?.sessionId ?? null,
      channel: e.channel ?? null,
      status: e.actionState?.status ?? null,
      step: e.actionState?.step ?? null,
    }))
    .sort(
      (a, b) =>
        new Date(b.emittedAt).getTime() - new Date(a.emittedAt).getTime(),
    );

  return {
    events: events.slice(0, limit),
    total: events.length,
    computedAt: new Date(now).toISOString(),
  };
}
