/**
 * @fileType utility
 * @domain kody
 * @pattern activity-run-logs
 * @ai-summary Pure helpers for Activity -> Run Logs. Parses Kody run-log
 *   artifact zips and folds events.jsonl into a compact timeline.
 */
import { inflateRawSync } from "node:zlib";

export type KodyRunTimelineCategory =
  | "stage"
  | "preflight"
  | "postflight"
  | "agent"
  | "container"
  | "failure";

export interface KodyRunLogEvent {
  ts?: string;
  runId?: string;
  agentAction?: string;
  kind?: string;
  name?: string;
  durationMs?: number;
  outcome?: string;
  meta?: Record<string, unknown>;
}

export interface KodyRunTimelineItem {
  id: string;
  ts: string | null;
  runId: string | null;
  agentAction: string | null;
  kind: string;
  name: string | null;
  durationMs: number | null;
  outcome: string | null;
  category: KodyRunTimelineCategory;
  summary: string;
  detail: string | null;
  failureReason: string | null;
  exitCode: number | null;
  meta: Record<string, unknown> | null;
}

export interface ParsedKodyRunLog {
  events: KodyRunLogEvent[];
  timeline: KodyRunTimelineItem[];
}

export interface KodyRunLogsRun {
  runId: number;
  runAttempt: number;
  runNumber: number | null;
  title: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  artifactName: string;
  artifactStatus: "available" | "missing" | "expired" | "error";
  artifactUrl: string | null;
  message: string | null;
  events: KodyRunLogEvent[];
  timeline: KodyRunTimelineItem[];
}

export interface KodyRunLogsSnapshot {
  runs: KodyRunLogsRun[];
  total: number;
  available: number;
  missing: number;
  computedAt: string;
}

const STAGE_KINDS = new Set(["stage_start", "stage_end"]);

function textOf(event: KodyRunLogEvent): string {
  return [event.kind, event.name, event.agentAction]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function failureReason(event: KodyRunLogEvent): string | null {
  return stringOrNull(event.meta?.reason);
}

function exitCode(event: KodyRunLogEvent): number | null {
  return numberOrNull(event.meta?.exitCode);
}

function isFailure(event: KodyRunLogEvent): boolean {
  const outcome = event.outcome?.toLowerCase();
  return (
    outcome === "failure" ||
    outcome === "failed" ||
    outcome === "error" ||
    textOf(event).includes("fail") ||
    failureReason(event) != null ||
    exitCode(event) != null
  );
}

function categoryFor(event: KodyRunLogEvent): KodyRunTimelineCategory | null {
  if (isFailure(event)) return "failure";
  if (event.kind && STAGE_KINDS.has(event.kind)) return "stage";

  const text = textOf(event);
  if (text.includes("preflight")) return "preflight";
  if (text.includes("postflight")) return "postflight";
  if (text.includes("agent")) return "agent";
  if (text.includes("container")) return "container";
  return null;
}

function labelFor(event: KodyRunLogEvent): string {
  return event.name || event.agentAction || event.kind || "event";
}

function summaryFor(
  event: KodyRunLogEvent,
  category: KodyRunTimelineCategory,
): string {
  const label = labelFor(event);
  if (category === "failure") return `Failure: ${label}`;
  if (event.kind === "stage_start") return `Stage started: ${label}`;
  if (event.kind === "stage_end") return `Stage ended: ${label}`;
  if (category === "preflight") return `Preflight: ${label}`;
  if (category === "postflight") return `Postflight: ${label}`;
  if (category === "agent") return `Agent: ${label}`;
  return `Container: ${label}`;
}

function detailFor(event: KodyRunLogEvent): string | null {
  const reason = failureReason(event);
  if (reason) return reason;
  const code = exitCode(event);
  if (code != null) return `exit ${code}`;
  if (event.outcome) return event.outcome;
  return null;
}

export function parseKodyRunEventsJsonl(jsonl: string): KodyRunLogEvent[] {
  const events: KodyRunLogEvent[] = [];
  for (const line of jsonl.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as KodyRunLogEvent;
      events.push(parsed);
    } catch {
      // One malformed event should not hide the rest of the run timeline.
    }
  }
  return events;
}

export function buildRunTimeline(
  events: KodyRunLogEvent[],
): KodyRunTimelineItem[] {
  return events
    .map((event, index) => {
      const category = categoryFor(event);
      if (!category) return null;
      return {
        id: `${event.runId ?? "run"}:${event.ts ?? index}:${event.kind ?? "event"}:${event.name ?? index}`,
        ts: event.ts ?? null,
        runId: event.runId ?? null,
        agentAction: event.agentAction ?? null,
        kind: event.kind ?? "event",
        name: event.name ?? null,
        durationMs: numberOrNull(event.durationMs),
        outcome: event.outcome ?? null,
        category,
        summary: summaryFor(event, category),
        detail: detailFor(event),
        failureReason: failureReason(event),
        exitCode: exitCode(event),
        meta: event.meta ?? null,
      } satisfies KodyRunTimelineItem;
    })
    .filter((item): item is KodyRunTimelineItem => item != null)
    .sort((a, b) => {
      if (!a.ts && !b.ts) return 0;
      if (!a.ts) return 1;
      if (!b.ts) return -1;
      return new Date(a.ts).getTime() - new Date(b.ts).getTime();
    });
}

export function extractZipEntryText(
  zip: Buffer,
  entryPath: string,
): string | null {
  const eocd = findEndOfCentralDirectory(zip);
  if (eocd < 0) return null;

  const totalEntries = zip.readUInt16LE(eocd + 10);
  let cursor = zip.readUInt32LE(eocd + 16);

  for (let i = 0; i < totalEntries; i += 1) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) return null;

    const compression = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const filenameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip
      .subarray(cursor + 46, cursor + 46 + filenameLength)
      .toString("utf8");

    if (name === entryPath) {
      return readLocalZipEntry(zip, localOffset, compressedSize, compression);
    }

    cursor += 46 + filenameLength + extraLength + commentLength;
  }

  return null;
}

export function parseKodyRunLogZip(
  zip: Buffer,
  runId: number | string,
): ParsedKodyRunLog | null {
  const jsonl = extractZipEntryText(
    zip,
    `.kody/agent-runs/${runId}/events.jsonl`,
  );
  if (jsonl == null) return null;
  const events = parseKodyRunEventsJsonl(jsonl);
  return {
    events,
    timeline: buildRunTimeline(events),
  };
}

export function buildRunLogsSnapshot(
  runs: KodyRunLogsRun[],
  now: number = Date.now(),
): KodyRunLogsSnapshot {
  return {
    runs,
    total: runs.length,
    available: runs.filter((run) => run.artifactStatus === "available").length,
    missing: runs.filter((run) => run.artifactStatus !== "available").length,
    computedAt: new Date(now).toISOString(),
  };
}

function findEndOfCentralDirectory(zip: Buffer): number {
  const min = Math.max(0, zip.length - 0xffff - 22);
  for (let i = zip.length - 22; i >= min; i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function readLocalZipEntry(
  zip: Buffer,
  localOffset: number,
  compressedSize: number,
  compression: number,
): string | null {
  if (zip.readUInt32LE(localOffset) !== 0x04034b50) return null;
  const filenameLength = zip.readUInt16LE(localOffset + 26);
  const extraLength = zip.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + filenameLength + extraLength;
  const compressed = zip.subarray(dataStart, dataStart + compressedSize);

  if (compression === 0) return compressed.toString("utf8");
  if (compression === 8) return inflateRawSync(compressed).toString("utf8");
  return null;
}
