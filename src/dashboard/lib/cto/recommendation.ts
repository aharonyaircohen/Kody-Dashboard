/**
 * @fileType utility
 * @domain kody
 * @pattern cto-recommendation-detect
 * @ai-summary Pure detector: given an inbox entry, decide whether it is a
 *   agent recommendation and, if so, extract the emitting agent slug, the
 *   task number, and the *actual* action named. Every agent leads its
 *   recommendation comment with a prose marker (`🧭 **CTO recommendation** —
 *   \`<action>\``, `🧪 **QA result** — \`<action>\``, …) AND a machine-readable
 *   `<!-- kody-agent: <slug> -->` HTML comment (see .kody/agents/*.md). The
 *   slug line is the deterministic identity signal — it survives any agentIdentity's
 *   wording and is stripped from the inbox snippet (buildSnippet drops HTML
 *   comments), so the operator never sees it. Legacy recs that predate the
 *   slug line fall back to the CTO marker and default to the `cto` slug.
 *
 *   Only `execute`/`fix` are *dispatchable* from the dashboard: both resolve
 *   to the engine's single write path (an `@kody` comment on the task — for
 *   `fix` the QA-failure comment is already in-thread, so re-dispatching is
 *   the fix). `qa-review`/`approve`/`comment` have no dashboard executor
 *   (per cto.md, approve is a human merge gate) — they surface read-only so
 *   approving can never silently post the wrong command.
 */
import type { InboxEntry } from "../inbox/types";

export const DEFAULT_AGENT_SLUG = "cto";

/**
 * Every action the CTO agent may emit (see cto.md "Restrictions"), plus
 * `other` — a catch-all for marker-bearing comments whose verb we can't
 * parse (legacy / free-form recs). `other` is non-dispatchable and lives in
 * its own ledger bucket, so an unparsed rec stays visible (Reject + GitHub
 * link) without ever rerouting to `@kody` or polluting `execute` trust.
 */
export const CTO_ACTIONS = [
  "execute",
  "fix",
  "fix-ci",
  "sync",
  "resolve",
  "qa-review",
  // Dashboard-executed (NOT an `@kody` command — the engine never auto-merges).
  // Approve on a `merge` rec squash-merges the PR via the GitHub API; the
  // QA-verify duty emits these once ui-review confirms the fix/feature works.
  "merge",
  "approve",
  "comment",
  "other",
] as const;
export type CtoAction = (typeof CTO_ACTIONS)[number];

/** Back-compat alias — callers that only cared about the type name. */
export type CtoActionable = CtoAction;

/**
 * Legacy fallback only. The command to run now comes from the CTO's own
 * `<!-- kody-cmd: @kody … -->` line (see cto.md); this map is used only for
 * older recs written before that line existed, so they stay actionable.
 */
const FALLBACK_COMMAND: Partial<Record<CtoAction, string>> = {
  execute: "@kody",
  fix: "@kody",
  // PR-health primitives. Recs always carry the exact `<!-- kody-cmd:
  // @kody <verb> --pr N -->` line (that wins in the approve path); these
  // bare fallbacks exist only so the verbs read as *dispatchable* for
  // legacy recs written before the kody-cmd line.
  "fix-ci": "@kody fix-ci",
  sync: "@kody sync",
  resolve: "@kody resolve",
  "qa-review": "@kody ui-review",
};

/** Max length of a CTO-emitted command we'll post verbatim. */
const MAX_COMMAND_LEN = 300;

/**
 * Verbs the engine has no executable for. A `kody-cmd` naming one is an agentIdentity
 * bug — e.g. the QA duty emitting `@kody approve` for a PASS/CONCERNS result.
 * `approve`/`reject`/`dismiss` are human inbox gates, not engine commands, so
 * posting them verbatim makes the engine reply "I don't recognize approve."
 * Treat any such command as invalid so the rec surfaces read-only instead.
 */
const NON_ENGINE_VERBS = new Set(["approve", "reject", "dismiss"]);

/** True for `@kody <verb>` whose verb the engine can't dispatch (dead verb). */
export function isNonEngineCommand(cmd: string): boolean {
  const verb = cmd.slice("@kody".length).trim().split(/\s+/)[0]?.toLowerCase();
  return verb ? NON_ENGINE_VERBS.has(verb) : false;
}

/**
 * Extract the literal command the CTO wants Approve to post, from the raw
 * comment body. Guarded: must be a single `@kody …` line, length-capped, and
 * not a non-engine verb (see `NON_ENGINE_VERBS`). Returns null when
 * absent/invalid (rec then surfaces read-only).
 */
export function parseCtoCommand(rawBody: string): string | null {
  const m = rawBody.match(/<!--\s*kody-cmd:\s*(@kody[^\n]*?)\s*-->/i);
  if (!m) return null;
  const cmd = m[1].trim();
  if (!cmd.startsWith("@kody") || cmd.length > MAX_COMMAND_LEN) return null;
  if (isNonEngineCommand(cmd)) return null;
  return cmd;
}

/**
 * Read the emitting agent slug from a rec's `<!-- kody-agent: <slug> -->`
 * line — the deterministic identity signal every agentIdentity now writes
 * (sibling to `kody-cmd`). Slugs are lowercase `[a-z0-9-]`. Returns null when
 * absent (legacy recs predate the line; the caller defaults them to the CTO).
 * The HTML comment is stripped from the inbox snippet, so it's never shown.
 */
export function parseCtoAgent(rawBody: string): string | null {
  const m = rawBody.match(/<!--\s*kody-agent:\s*([a-z0-9][a-z0-9-]*)\s*-->/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Read the emitting DUTY slug from a rec's `<!-- kody-duty: <slug> -->` line —
 * the engine stamps this (code, not the LLM) so trust can be keyed per duty,
 * not just per agentIdentity. Sibling duties of one agentIdentity (e.g. `qa-sweep` vs
 * `qa-verify`, both `qa`) thus earn autonomy independently. Returns null on
 * legacy recs that predate the line; callers fall back to the agentIdentity slug.
 */
export function parseCtoDuty(rawBody: string): string | null {
  const m = rawBody.match(/<!--\s*kody-duty:\s*([a-z0-9][a-z0-9-]*)\s*-->/i);
  return m ? m[1].toLowerCase() : null;
}

export function isDispatchable(action: CtoAction): boolean {
  return action in FALLBACK_COMMAND;
}

/** Legacy verb→command fallback for recs with no explicit `kody-cmd`. */
export function dispatchCommand(action: CtoAction): string | null {
  return FALLBACK_COMMAND[action] ?? null;
}

export interface CtoRecommendation {
  /** Slug of the agent that emitted the rec (legacy → "cto"). */
  agent: string;
  /**
   * Slug of the DUTY that emitted the rec — the trust key. Falls back to the
   * agentIdentity slug for legacy recs the engine hasn't stamped with `kody-duty`.
   */
  duty: string;
  taskNumber: number;
  action: CtoAction;
  /** The exact `@kody …` command Approve will post, or null if none. */
  command: string | null;
  /** True when Approve can actually run the action from the dashboard. */
  dispatchable: boolean;
}

const MARKER = /CTO recommendation/i;

/**
 * Pull `123` out of a `.../issues/123` or `.../pull/123` URL (with or
 * without a `#…` fragment). PR-health recs (`fix-ci`/`sync`/`resolve`)
 * are posted on pull requests, so `/pull/` must parse too.
 */
function issueNumberFromUrl(url: string): number | null {
  const m = url.match(/\/(?:issues|pull)\/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Read the action the CTO named on the marker line. We scan for the longest
 * matching verb first (`qa-review` before `review`-free tokens) so a
 * substring never wins. Returns null when no known verb is present — we
 * fail closed rather than assume `execute` (the old bug).
 */
const PARSEABLE: CtoAction[] = [
  "qa-review",
  "execute",
  // `fix-ci` MUST precede `fix` — `\bfix\b` also matches the "fix" inside
  // "fix-ci", so the longer verb has to win first.
  "fix-ci",
  "fix",
  "sync",
  "resolve",
  "merge",
  "approve",
  "comment",
];

/**
 * Actions the dashboard executes itself rather than posting an `@kody`
 * command. `merge` squash-merges the PR via the GitHub API (the engine never
 * auto-merges). These are *dispatchable* (Approve acts) even though they carry
 * no `kody-cmd` line.
 */
const DASHBOARD_ACTIONS = new Set<CtoAction>(["merge"]);

/** True for an action the dashboard runs directly (e.g. `merge`). */
export function isDashboardAction(action: CtoAction): boolean {
  return DASHBOARD_ACTIONS.has(action);
}

function parseAction(haystack: string): CtoAction | null {
  for (const a of PARSEABLE) {
    if (new RegExp(`\\b${a.replace("-", "[- ]?")}\\b`, "i").test(haystack)) {
      return a;
    }
  }
  return null;
}

/**
 * Parse the recommendation action from a *raw* comment body (backticks
 * intact) at inbox-write time. This is the reliable path: the 240-char
 * plain-text snippet collapses backtick spans to `[code]`, so the verb on the
 * marker line is often gone by the time the client sees it. A body is a
 * recommendation if it carries the explicit `kody-agent` line (any agentIdentity)
 * OR the legacy CTO marker. Returns null otherwise. Stored as `ctoAction`.
 */
export function parseCtoAction(rawBody: string): CtoAction | null {
  if (!parseCtoAgent(rawBody) && !MARKER.test(rawBody)) return null;
  // Marker present ⇒ it IS a recommendation. Mirror detectCtoRecommendation:
  // an unrecoverable verb is `other` (non-dispatchable), never null. If this
  // returned null the entry would carry no `ctoAction`, and BOTH the pending
  // cap (applyCtoBackpressure) and the duplicate-collapse (ctoFeedKey) skip
  // anything without `ctoAction` — that silent bypass is exactly the flood.
  return parseAction(rawBody) ?? "other";
}

/** Narrow an arbitrary string to a known CtoAction (for stored values). */
function asCtoAction(v: string | undefined): CtoAction | null {
  return v && (CTO_ACTIONS as readonly string[]).includes(v)
    ? (v as CtoAction)
    : null;
}

/**
 * Strip CTO-specific boilerplate (marker prefix, "Confirming will run…"
 * sentence, trailing "Confirm or dismiss…" instruction) from a *cleaned*
 * snippet so the inbox preview shows only the reason.
 *
 *   "🧭 CTO recommendation — sync. PR #1405 is 15 commits behind base.
 *    Confirming will run @kody sync --pr 1405 to rebase or merge.
 *    Confirm or dismiss this in the dashboard inbox."
 *      ↓
 *   "PR #1405 is 15 commits behind base."
 *
 * The row already shows the action+task in the chip below, so duplicating
 * "CTO recommendation — sync" in the preview is dead pixels. Returns the
 * input unchanged if no marker is found (defensive: legacy bodies).
 */
export function ctoCleanSnippet(snippet: string): string {
  if (!snippet) return "";
  let out = snippet;
  // Drop everything up to and including the marker line — the compass +
  // "CTO recommendation — <action>" prefix. The em-dash variants (— -)
  // and the verb token both vary, so anchor on "CTO recommendation".
  out = out.replace(/^.*?CTO recommendation\s*[—–-]\s*[^.\s]+\s*\.?\s*/i, "");
  // Drop the dashboard-handoff sentence the agent tacks on.
  out = out.replace(/Confirming will run [^.]*\.\s*/i, "");
  // Drop the trailing "Confirm or dismiss this in the dashboard inbox."
  // (with or without surrounding underscores, already stripped by buildSnippet).
  out = out.replace(/Confirm or dismiss this[^.]*\.?\s*$/i, "");
  return out.trim();
}

export function detectCtoRecommendation(
  entry: InboxEntry,
): CtoRecommendation | null {
  // The server parses the marker from the *raw* body at write time and
  // stores the verb on `entry.ctoAction`. Trust that first: the 240-char
  // snippet routinely truncates the marker line away, so re-testing the
  // marker against `title + snippet` would drop a valid rec — that's the
  // "no Approve/Reject buttons" bug. Only legacy entries written before
  // `ctoAction` existed fall back to the lossy marker re-check.
  const storedAction = asCtoAction(entry.ctoAction);
  const haystack = `${entry.title ?? ""} ${entry.snippet ?? ""}`;
  if (!storedAction && !MARKER.test(haystack)) return null;
  // CTO recs land on issues (legacy task flow) or pull requests
  // (PR-health: fix-ci/sync/resolve). Block only non-issue/PR threads
  // (e.g. Discussion) so a goal mention never misroutes as a rec.
  if (entry.threadType && !/issue|pullrequest/i.test(entry.threadType)) {
    return null;
  }

  const taskNumber = issueNumberFromUrl(entry.url);
  if (taskNumber === null) return null;

  // Prefer the action parsed from the raw body at write time (`ctoAction`).
  // Fall back to the lossy snippet for legacy entries written before that
  // field existed. Marker present but verb unrecoverable → `other`
  // (non-dispatchable) so the rec stays visible without ever misrouting.
  const action: CtoAction = storedAction ?? parseAction(haystack) ?? "other";

  // The command the CTO explicitly asked Approve to post (parsed from the
  // raw body at write time) wins. Legacy recs with no `kody-cmd` line fall
  // back to the verb→command map. No command → read-only (never misroute).
  // Entries persisted before the parse-time guard (or by a regressed agentIdentity)
  // may carry a dead verb like `@kody approve`; drop it so we never post a
  // command the engine rejects.
  const stored = entry.ctoCommand?.trim();
  const command =
    stored && stored.startsWith("@kody") && !isNonEngineCommand(stored)
      ? stored
      : (dispatchCommand(action) ?? null);

  // Agent slug parsed at write time wins; legacy entries (CTO marker, no
  // slug line) default to the CTO so their trust keeps accruing under `cto`.
  const agent = entry.ctoAgent ?? DEFAULT_AGENT_SLUG;

  // Duty slug is the trust key. The engine stamps `kody-duty` on every rec;
  // recs that predate it fall back to the agentIdentity slug so trust still records
  // somewhere coherent (per-agentIdentity) until the engine ships the stamp.
  const duty = entry.ctoDuty ?? agent;

  // `merge` is dashboard-executed (no `@kody` command) but still actionable —
  // Approve squash-merges the PR. Other actions are dispatchable iff they
  // resolved to a command to post.
  const dispatchable = isDashboardAction(action) || command !== null;
  return { agent, duty, taskNumber, action, command, dispatchable };
}
