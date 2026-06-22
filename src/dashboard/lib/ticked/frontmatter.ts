/**
 * @fileType util
 * @domain kody
 * @pattern ticked-frontmatter
 * @ai-summary Tiny YAML-frontmatter parser/serializer for legacy
 *   "ticked markdown" records. Duties now store metadata in
 *   `.kody/duties/<slug>/profile.json`; this module remains for agent and
 *   for schedule/type helpers reused by the folder-backed duty UI.
 *
 *   No `gray-matter` dep on purpose — the format is intentionally
 *   restricted (flat, scalar values only) and a 30-line parser keeps
 *   the bundle small. `duties-frontmatter.ts` is a thin re-export shim
 *   over this single implementation.
 */

/** Allowed cadence tokens. Engine cron fires every 15 min; finer values round up. */
export type ScheduleEvery =
  | "15m"
  | "30m"
  | "1h"
  | "2h"
  | "6h"
  | "12h"
  | "1d"
  | "3d"
  | "7d"
  /**
   * Sentinel: the scheduler never auto-fires this record. Only manual triggers
   * (workflow_dispatch via the dashboard "Run now" button) execute it.
   */
  | "manual";

const SCHEDULE_EVERY_VALUES: readonly ScheduleEvery[] = [
  "15m",
  "30m",
  "1h",
  "2h",
  "6h",
  "12h",
  "1d",
  "3d",
  "7d",
  "manual",
] as const;

export interface TickFrontmatter {
  /**
   * Public `@kody <action>` name for a duty. Duties own the command surface;
   * executables remain implementation units.
   */
  action?: string;
  /**
   * Primary implementation executable for a duty. This is the normal
   * duty→executable link; `executables:` remains for legacy/multi-run duties.
   */
  executable?: string;
  /** Cadence between ticks. Absent = "every cron wake" (legacy default). */
  every?: ScheduleEvery;
  /**
   * When `true`, the scheduler skips this record on every cron wake. Manual
   * triggers (the dashboard "Run now" button) still fire — disabling only
   * blocks autonomous execution, not deliberate user action. Absent or
   * `false` keeps the file active.
   */
  disabled?: boolean;
  /**
   * Slug of the agent (agentIdentity) under `.kody/agents/<agent>.md` that
   * executes this duty in legacy markdown metadata. Folder-backed duties store
   * the same value in `profile.json.agent`.
   */
  agent?: string;
  /**
   * Agent slug responsible for reviewing this duty's output. Folder-backed
   * duties store the same value in `profile.json.reviewer`.
   */
  reviewer?: string;
  /**
   * GitHub logins this file's output should `@`-mention. Stored as a
   * comma-separated list on one line (`mentions: alice, bob`), no leading
   * `@`. The engine reads it to ping the listed users in the duty's report.
   * Absent / empty array = no mentions (the line is omitted on write).
   */
  mentions?: string[];
  /**
   * Legacy or multi-run executable slugs this duty can dispatch. New single
   * implementation duties should use `executable: <slug>`.
   */
  executables?: string[];
  /**
   * Tool names exposed to the duty tick agent. Stored on the engine-facing
   * `tools:` metadata line in legacy markdown records.
   */
  dutyTools?: string[];
  /**
   * Optional script path the engine runs before/for the tick. `null` writes
   * no line; a non-empty string emits `tickScript: <path>`.
   */
  tickScript?: string | null;
  /** Context/report/duty slugs this duty reads. */
  readsFrom?: string[];
  /** Report/context slugs this duty writes. */
  writesTo?: string[];
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Parse the leading frontmatter block (if any) from raw markdown. Returns
 * the recognized fields and the body that follows the block.
 */
export function splitFrontmatter(raw: string): {
  frontmatter: TickFrontmatter;
  body: string;
} {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { frontmatter: {}, body: raw };
  const inner = match[1] ?? "";
  const body = raw.slice(match[0].length);
  return { frontmatter: parseFlatYaml(inner), body };
}

/**
 * Re-attach a frontmatter block to a body. If `frontmatter` has no
 * recognized fields, the body is returned unchanged so we don't litter
 * empty `---` blocks across ticked files.
 */
export function joinFrontmatter(
  frontmatter: TickFrontmatter,
  body: string,
): string {
  const lines = serializeFlatYaml(frontmatter);
  if (lines.length === 0) return body;
  return `---\n${lines.join("\n")}\n---\n\n${body.replace(/^\s+/, "")}`;
}

/** True if the value matches one of the supported cadence tokens. */
export function isScheduleEvery(value: unknown): value is ScheduleEvery {
  return (
    typeof value === "string" &&
    (SCHEDULE_EVERY_VALUES as readonly string[]).includes(value)
  );
}

export const ALL_SCHEDULE_EVERY_OPTIONS = SCHEDULE_EVERY_VALUES;

/**
 * Convert a cadence token to milliseconds. Used by the dashboard to
 * compute "next due" estimates and by the engine to gate ticks.
 */
export function scheduleEveryToMs(every: ScheduleEvery): number {
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  switch (every) {
    case "15m":
      return 15 * MIN;
    case "30m":
      return 30 * MIN;
    case "1h":
      return HOUR;
    case "2h":
      return 2 * HOUR;
    case "6h":
      return 6 * HOUR;
    case "12h":
      return 12 * HOUR;
    case "1d":
      return DAY;
    case "3d":
      return 3 * DAY;
    case "7d":
      return 7 * DAY;
    case "manual":
      // Sentinel: never auto-fires. Returning Infinity is defensive — call
      // sites that compare "elapsed >= interval" get a clean "never due".
      return Number.POSITIVE_INFINITY;
  }
}

/** Human-readable label for a cadence token. */
export function scheduleEveryLabel(every: ScheduleEvery): string {
  switch (every) {
    case "15m":
      return "every 15 min";
    case "30m":
      return "every 30 min";
    case "1h":
      return "every hour";
    case "2h":
      return "every 2 hours";
    case "6h":
      return "every 6 hours";
    case "12h":
      return "every 12 hours";
    case "1d":
      return "every day";
    case "3d":
      return "every 3 days";
    case "7d":
      return "every week";
    case "manual":
      return "manual only";
  }
}

// ────────────────────────────────────────────────────────────────────
// Internals — flat YAML only (key: scalar). No nesting, no flow style.
// ────────────────────────────────────────────────────────────────────

function parseFlatYaml(text: string): TickFrontmatter {
  const out: TickFrontmatter = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = stripQuotes(line.slice(colon + 1).trim());
    if (key === "action" && value.length > 0) {
      out.action = value;
    } else if (key === "executable" && value.length > 0) {
      out.executable = value;
    } else if (key === "every" && isScheduleEvery(value)) {
      out.every = value;
    } else if (key === "disabled") {
      // Accept true/false (any case); anything else stays absent.
      const lower = value.toLowerCase();
      if (lower === "true") out.disabled = true;
      else if (lower === "false") out.disabled = false;
    } else if ((key === "agent" || key === "agent") && value.length > 0) {
      out.agent = value;
    } else if (key === "reviewer" && value.length > 0) {
      out.reviewer = value.replace(/^@/, "");
    } else if (key === "mentions") {
      // Comma-separated logins on one line; trim, strip an optional leading
      // `@`, drop empties. Only set the field when at least one login remains.
      const mentions = parseCommaList(value).map((m) => m.replace(/^@/, ""));
      if (mentions.length > 0) out.mentions = mentions;
    } else if (key === "executables") {
      const executables = parseCommaList(value);
      if (executables.length > 0) out.executables = executables;
    } else if (key === "tools") {
      const tools = parseCommaList(value);
      if (tools.length > 0) out.dutyTools = tools;
    } else if (key === "tickScript" && value.length > 0) {
      out.tickScript = value;
    } else if (key === "reads_from") {
      const readsFrom = parseCommaList(value);
      if (readsFrom.length > 0) out.readsFrom = readsFrom;
    } else if (key === "writes_to") {
      const writesTo = parseCommaList(value);
      if (writesTo.length > 0) out.writesTo = writesTo;
    }
    // Unknown keys silently dropped on read — they round-trip via the
    // raw body if callers preserve it. We don't surface them on the
    // dashboard until a feature explicitly needs them.
  }
  return out;
}

function serializeFlatYaml(frontmatter: TickFrontmatter): string[] {
  const lines: string[] = [];
  if (frontmatter.action) lines.push(`action: ${frontmatter.action}`);
  if (frontmatter.executable)
    lines.push(`executable: ${frontmatter.executable}`);
  if (frontmatter.every) lines.push(`every: ${frontmatter.every}`);
  if (frontmatter.agent) lines.push(`agent: ${frontmatter.agent}`);
  if (frontmatter.reviewer)
    lines.push(`reviewer: ${frontmatter.reviewer.replace(/^@/, "")}`);
  // Comma-separated logins on one line, no leading `@`. Omitted when empty
  // so an unchanged file stays byte-identical.
  if (frontmatter.mentions?.length)
    lines.push(`mentions: ${frontmatter.mentions.join(", ")}`);
  if (frontmatter.executables?.length)
    lines.push(`executables: ${frontmatter.executables.join(", ")}`);
  if (frontmatter.dutyTools?.length)
    lines.push(`tools: ${frontmatter.dutyTools.join(", ")}`);
  if (frontmatter.tickScript?.trim())
    lines.push(`tickScript: ${frontmatter.tickScript.trim()}`);
  if (frontmatter.readsFrom?.length)
    lines.push(`reads_from: ${frontmatter.readsFrom.join(", ")}`);
  if (frontmatter.writesTo?.length)
    lines.push(`writes_to: ${frontmatter.writesTo.join(", ")}`);
  // Only emit `disabled: true` — the default (enabled) leaves the line
  // out so an unchanged ticked file stays byte-identical.
  if (frontmatter.disabled === true) lines.push(`disabled: true`);
  return lines;
}

function parseCommaList(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}
