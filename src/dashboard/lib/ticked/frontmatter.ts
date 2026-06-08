/**
 * @fileType util
 * @domain kody
 * @pattern ticked-frontmatter
 * @ai-summary Tiny YAML-frontmatter parser/serializer shared by every
 *   "ticked markdown" feature (duties, staff, and any future kind). A
 *   ticked file is allowed to start with a `---\n…\n---\n` block carrying
 *   flat scalar key/value pairs (no nesting). Today the only recognized
 *   fields are `every:` (per-file cadence) and `disabled:`, but the
 *   parser preserves any other keys so engine-side features can read
 *   them without dashboard awareness.
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
   * Sentinel: the scheduler never auto-fires this file. Only manual triggers
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
  /** Cadence between ticks. Absent = "every cron wake" (legacy default). */
  every?: ScheduleEvery;
  /**
   * When `true`, the scheduler skips this file on every cron wake. Manual
   * triggers (the dashboard "Run now" button) still fire — disabling only
   * blocks autonomous execution, not deliberate user action. Absent or
   * `false` keeps the file active.
   */
  disabled?: boolean;
  /**
   * Slug of the staff member (persona) under `.kody/staff/<staff>.md` that
   * executes this duty. Duties own the schedule; the staff member is *who*
   * the tick runs as. Only meaningful on duty files — staff files never
   * carry it. A duty with no `staff:` is skipped by the engine scheduler.
   */
  staff?: string;
  /**
   * GitHub logins this file's output should `@`-mention. Stored as a
   * comma-separated list on one line (`mentions: alice, bob`), no leading
   * `@`. The engine reads it to ping the listed users in the duty's report.
   * Absent / empty array = no mentions (the line is omitted on write).
   */
  mentions?: string[];
  /**
   * Engine-side `executables: [name1, name2]`. Names a chain of built-in or
   * custom engine executables the duty composes into one tick — e.g. a
   * duty that wants to `research` then `plan` runs both, in order, against
   * the duty body. Free-form string list; the dashboard does not validate
   * the names because engine built-ins may be valid.
   */
  executables?: string[];
  /**
   * Engine-side duty-only tool allowlist (the `tools` frontmatter key on
   * a duty file). Distinct from the staff/executable `claudeCode.tools`
   * the agent uses at runtime — duty tools are what the tick loop may
   * invoke when running the duty's body. Stored on disk as `tools:` (no
   * separate `dutyTools:` key); the dashboard surfaces this as
   * `dutyTools` everywhere in the API.
   */
  dutyTools?: string[];
  /**
   * Optional inline script the engine can run before the duty tick (e.g.
   * an extra data gather step). Rendered verbatim as the `tickScript:`
   * frontmatter value. `null` clears the field on write.
   */
  tickScript?: string | null;
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
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) {
      i++;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon < 0) {
      i++;
      continue;
    }
    const key = line.slice(0, colon).trim();
    let value = stripQuotes(line.slice(colon + 1).trim());
    i++;

    // tickScript may use a YAML block scalar (`|` / `>`) for multi-line
    // scripts. Read the indented continuation into one string.
    if (key === "tickScript" && (value === "|" || value === ">")) {
      const block: string[] = [];
      while (i < lines.length) {
        const next = lines[i];
        if (next === "" || /^\s/.test(next)) {
          block.push(next.replace(/^ {1,2}/, ""));
          i++;
        } else {
          break;
        }
      }
      while (block.length > 0 && block[block.length - 1] === "") {
        block.pop();
      }
      if (block.length > 0) out.tickScript = block.join("\n");
      continue;
    }

    if (key === "every" && isScheduleEvery(value)) {
      out.every = value;
    } else if (key === "disabled") {
      // Accept true/false (any case); anything else stays absent.
      const lower = value.toLowerCase();
      if (lower === "true") out.disabled = true;
      else if (lower === "false") out.disabled = false;
    } else if (key === "staff" && value.length > 0) {
      out.staff = value;
    } else if (key === "mentions") {
      // Comma-separated logins on one line; trim, strip an optional leading
      // `@`, drop empties. Only set the field when at least one login remains.
      const mentions = value
        .split(",")
        .map((m) => m.trim().replace(/^@/, ""))
        .filter((m) => m.length > 0);
      if (mentions.length > 0) out.mentions = mentions;
    } else if (key === "executables") {
      // Free-form engine executable names. We don't validate them — engine
      // built-ins may be valid and the dashboard doesn't know the registry.
      const exes = value
        .split(",")
        .map((m) => m.trim())
        .filter((m) => m.length > 0);
      if (exes.length > 0) out.executables = exes;
    } else if (key === "tools") {
      // The on-disk key for `dutyTools` is `tools` (the engine-side name).
      // The dashboard surfaces it as `dutyTools` to keep "agent tools" and
      // "duty tools" visually separate in the editor.
      const tools = value
        .split(",")
        .map((m) => m.trim())
        .filter((m) => m.length > 0);
      if (tools.length > 0) out.dutyTools = tools;
    } else if (key === "tickScript" && value.length > 0) {
      out.tickScript = value;
    }
    // Unknown keys silently dropped on read — they round-trip via the
    // raw body if callers preserve it. We don't surface them on the
    // dashboard until a feature explicitly needs them.
  }
  return out;
}

function serializeFlatYaml(frontmatter: TickFrontmatter): string[] {
  const lines: string[] = [];
  if (frontmatter.every) lines.push(`every: ${frontmatter.every}`);
  if (frontmatter.staff) lines.push(`staff: ${frontmatter.staff}`);
  // Comma-separated logins on one line, no leading `@`. Omitted when empty
  // so an unchanged file stays byte-identical.
  if (frontmatter.mentions?.length)
    lines.push(`mentions: ${frontmatter.mentions.join(", ")}`);
  // Only emit `disabled: true` — the default (enabled) leaves the line
  // out so an unchanged ticked file stays byte-identical.
  if (frontmatter.disabled === true) lines.push(`disabled: true`);
  if (frontmatter.executables?.length)
    lines.push(`executables: ${frontmatter.executables.join(", ")}`);
  // On-disk key is `tools`, in-memory key is `dutyTools`. The engine reads
  // `tools`; the API surfaces `dutyTools` to keep agent/duty tools distinct.
  if (frontmatter.dutyTools?.length)
    lines.push(`tools: ${frontmatter.dutyTools.join(", ")}`);
  // tickScript: single-line stays inline, multi-line uses a `|` block scalar
  // so the engine can read it back verbatim. `null` / empty string omits the
  // key entirely (the dashboard uses null to "clear" the field on PATCH).
  if (
    typeof frontmatter.tickScript === "string" &&
    frontmatter.tickScript.length > 0
  ) {
    if (frontmatter.tickScript.includes("\n")) {
      lines.push("tickScript: |");
      for (const ln of frontmatter.tickScript.split("\n")) {
        lines.push(`  ${ln}`);
      }
    } else {
      lines.push(`tickScript: ${frontmatter.tickScript}`);
    }
  }
  return lines;
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
